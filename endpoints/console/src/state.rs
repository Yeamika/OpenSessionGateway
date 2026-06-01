use std::collections::BTreeMap;

use osgp::{
    Envelope, LinkType, Payload, ReadResponse, RouteTarget, SessionAddress, SessionEnvelope,
};
use serde_json::Value;
use tracing::warn;

// ── Canonical subtype allowlists ─────────────────────────────────────
//
// HARD RULE: The Console endpoint only recognizes canonical business
// `type+subtype` pairs. Any non-canonical pair is WARN-logged and
// dropped — it will NOT be processed as a business message.
//
// This matches the router's behavior: the router defaults to ignoring,
// warning, and discarding any non-canonical type+subtype.
//
// Admin subtypes (`admin_request`, `admin_response`) are NOT business
// subtypes — they are internal router admin plane exceptions and are
// handled separately in `tui.rs`.

/// Upload subtypes: session lifecycle and requestion events.
const UPLOAD_SUBTYPES: &[&str] = &[
    "session_update",
    "requestion_asked",
    "requestion_updated",
    "requestion_resolved",
    "requestion_cancelled",
];

/// Control subtypes: session commands (outbound only, not received for state).
const CONTROL_SUBTYPES: &[&str] = &[
    "add_prompt",
    "abort_session",
    "compact_session",
    "create_session",
    "rename_session",
    "resume_session",
    "requestion_respond",
];

/// Request subtypes: read operations (outbound only, not received for state).
const REQUEST_SUBTYPES: &[&str] = &[
    "runtime_workspace_view_snapshot",
    "runtime_requestion_snapshot",
    "runtime_session_view_snapshot",
    "runtime_session_messages",
];

/// Admin internal exception subtypes — NOT canonical business subtypes.
/// These are handled separately by the admin plane and should never be
/// treated as normal upload/control/request/response business messages.
const ADMIN_EXCEPTION_SUBTYPES: &[&str] = &["admin_request", "admin_response"];

/// Check if a subtype is a canonical upload subtype.
pub fn is_canonical_upload(subtype: &str) -> bool {
    UPLOAD_SUBTYPES.contains(&subtype)
}

/// Check if a subtype is a canonical control subtype.
pub fn is_canonical_control(subtype: &str) -> bool {
    CONTROL_SUBTYPES.contains(&subtype)
}

/// Check if a subtype is a canonical request subtype.
pub fn is_canonical_request(subtype: &str) -> bool {
    REQUEST_SUBTYPES.contains(&subtype)
}

/// Check if a subtype is an admin internal exception (not a business subtype).
pub fn is_admin_exception(subtype: &str) -> bool {
    ADMIN_EXCEPTION_SUBTYPES.contains(&subtype)
}

/// Check if a type+subtype pair is a canonical business pair.
///
/// Returns `true` only if the pair is in the canonical allowlist.
/// Admin exception subtypes return `false` (they are not business pairs).
pub fn is_canonical_pair(link_type: &str, subtype: &str) -> bool {
    // Admin exceptions are not canonical business pairs
    if is_admin_exception(subtype) {
        return false;
    }
    match link_type {
        "upload" => is_canonical_upload(subtype),
        "control" => is_canonical_control(subtype),
        "request" => is_canonical_request(subtype),
        "response" => true, // Response mirrors request/control subtypes
        _ => false,
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SessionRow {
    pub runtime_id: String,
    pub session_id: String,
    pub title: String,
    pub state: String,
    pub last_update: String,
    pub summary: String,
    pub pending: Vec<String>,
    pub detail: String,
}

#[derive(Debug, Clone, Default)]
pub struct ConsoleState {
    sessions: BTreeMap<(String, String), SessionRow>,
    pub events: Vec<String>,
    pub selected: usize,
    /// Last admin response text (for TUI display).
    pub last_admin_response: Option<String>,
}

impl ConsoleState {
    /// Apply a legacy SessionEnvelope to the state.
    ///
    /// HARD RULE: Only canonical business `type+subtype` pairs are processed.
    /// Non-canonical pairs are WARN-logged and dropped — they will NOT be
    /// processed as business messages.
    ///
    /// Admin exception subtypes (`admin_request`, `admin_response`) are
    /// silently skipped — they are handled separately in `tui.rs`.
    pub fn apply_session_envelope(&mut self, envelope: &SessionEnvelope) {
        let link_type = envelope.link_type.as_str();
        let subtype = &envelope.subtype;

        // Skip admin exception subtypes — they are not business messages
        if is_admin_exception(subtype) {
            return;
        }

        // HARD RULE: Drop non-canonical type+subtype pairs with warning
        if !is_canonical_pair(link_type, subtype) {
            warn!(
                link_type = link_type,
                subtype = subtype,
                "non-canonical type+subtype pair dropped (not a recognized business message)"
            );
            return;
        }

        match link_type {
            "upload" => {
                // Only process canonical upload subtypes
                if is_canonical_upload(subtype) {
                    self.apply_upload(subtype, &envelope.payload, &envelope.source);
                }
            }
            "response" | "request" => {
                // Response/request: apply snapshot for display
                self.apply_snapshot(&envelope.payload, &envelope.source, link_type);
            }
            _ => {}
        }
        self.push_event(format!("{link_type} {subtype}"));
    }

    /// Apply a typed Envelope to the state.
    ///
    /// HARD RULE: Only canonical business `type+subtype` pairs are processed.
    /// Non-canonical pairs are WARN-logged and dropped.
    pub fn apply_typed_envelope(&mut self, envelope: &Envelope) {
        let payload = payload_value(&envelope.payload);
        let source = route_target_address(&envelope.source);
        let link_type = envelope.link_type.as_wire();
        let subtype = &envelope.subtype;

        // Skip admin exception subtypes
        if is_admin_exception(subtype) {
            return;
        }

        // HARD RULE: Drop non-canonical type+subtype pairs with warning
        if !is_canonical_pair(link_type, subtype) {
            warn!(
                link_type = link_type,
                subtype = subtype,
                "non-canonical type+subtype pair dropped (not a recognized business message)"
            );
            return;
        }

        match envelope.link_type {
            LinkType::Upload => {
                // Only process canonical upload subtypes
                if is_canonical_upload(subtype) {
                    self.apply_upload(subtype, &payload, &source);
                }
            }
            LinkType::Response | LinkType::Request => {
                self.apply_snapshot(&payload, &source, link_type);
            }
            _ => {}
        }
        self.push_event(format!("{link_type} {subtype}"));
    }

    /// Apply a ReadResponse to the state.
    ///
    /// ReadResponses are always from request subtypes, so no allowlist check needed.
    pub fn apply_read_response(&mut self, response: &ReadResponse) {
        self.apply_snapshot(&response.payload, &response.source, &response.link_type);
        self.push_event(format!(
            "response {} ok={}",
            response.subtype,
            response.is_ok()
        ));
    }

    pub fn rows(&self) -> Vec<SessionRow> {
        let mut rows: Vec<_> = self.sessions.values().cloned().collect();
        rows.sort_by(|a, b| {
            b.last_update
                .cmp(&a.last_update)
                .then(a.session_id.cmp(&b.session_id))
        });
        rows
    }

    pub fn selected_row(&self) -> Option<SessionRow> {
        self.rows().get(self.selected).cloned()
    }

    pub fn move_selection(&mut self, delta: isize) {
        let len = self.sessions.len();
        if len == 0 {
            self.selected = 0;
            return;
        }
        self.selected = (self.selected as isize + delta).clamp(0, len as isize - 1) as usize;
    }

    pub fn len(&self) -> usize {
        self.sessions.len()
    }

    pub fn pending_count(&self) -> usize {
        self.sessions.values().map(|r| r.pending.len()).sum()
    }

    /// Apply a canonical upload subtype to the state.
    ///
    /// Only called for subtypes that pass the `UPLOAD_SUBTYPES` allowlist check.
    /// Canonical upload subtypes: session_update, requestion_asked, requestion_updated,
    /// requestion_resolved, requestion_cancelled.
    fn apply_upload(&mut self, subtype: &str, payload: &Value, source: &SessionAddress) {
        match subtype {
            "session_update" => self.apply_session_update(payload, source),
            "requestion_asked" | "requestion_updated" => {
                self.upsert_requestion(payload, source, subtype)
            }
            "requestion_resolved" | "requestion_cancelled" => {
                self.resolve_requestion(payload, source)
            }
            // Non-canonical upload subtypes are silently ignored for state
            _ => {}
        }
    }

    fn apply_session_update(&mut self, payload: &Value, source: &SessionAddress) {
        let session_id = first_str(payload, &["sessionID", "sessionId"])
            .or(source.session.as_deref())
            .unwrap_or("<unknown>");
        let runtime_id = first_str(payload, &["runtimeID", "runtimeId", "runtime"])
            .or(source.runtime.as_deref())
            .unwrap_or("<unknown>");
        let title = first_str(payload, &["title", "name"]).unwrap_or("");
        let state = first_str(payload, &["state", "status"]).unwrap_or("unknown");
        let summary = first_str(payload, &["summary", "message", "lastMessage"]).unwrap_or("");
        let row = self.row_mut(runtime_id, session_id);
        if !title.is_empty() {
            row.title = title.into();
        }
        row.state = state.into();
        if !summary.is_empty() {
            row.summary = summary.into();
        }
        row.detail = compact_json(payload, 900);
        row.last_update = now_stamp();
    }

    fn upsert_requestion(&mut self, payload: &Value, source: &SessionAddress, subtype: &str) {
        let session_id = first_str(payload, &["sessionID", "sessionId"])
            .or(source.session.as_deref())
            .unwrap_or("<unknown>");
        let runtime_id = first_str(payload, &["runtimeID", "runtimeId", "runtime"])
            .or(source.runtime.as_deref())
            .unwrap_or("<unknown>");
        let request_id =
            first_str(payload, &["requestID", "requestId", "requestionId"]).unwrap_or("<unknown>");
        let title = first_str(payload, &["title", "prompt", "question", "summary"]).unwrap_or("");
        let row = self.row_mut(runtime_id, session_id);
        row.pending
            .retain(|p| !p.contains(&format!(":{request_id}")));
        row.pending.push(format!("{subtype}:{request_id}:{title}"));
        row.summary = format!("pending: {}", row.pending.join(" | "));
        row.detail = compact_json(payload, 900);
        row.last_update = now_stamp();
    }

    fn resolve_requestion(&mut self, payload: &Value, source: &SessionAddress) {
        let session_id = first_str(payload, &["sessionID", "sessionId"])
            .or(source.session.as_deref())
            .unwrap_or("<unknown>");
        let runtime_id = first_str(payload, &["runtimeID", "runtimeId", "runtime"])
            .or(source.runtime.as_deref())
            .unwrap_or("<unknown>");
        let request_id =
            first_str(payload, &["requestID", "requestId", "requestionId"]).unwrap_or("<unknown>");
        let row = self.row_mut(runtime_id, session_id);
        row.pending
            .retain(|p| !p.contains(&format!(":{request_id}")));
        row.summary = if row.pending.is_empty() {
            "pending: none".into()
        } else {
            format!("pending: {}", row.pending.join(" | "))
        };
        row.last_update = now_stamp();
    }

    fn apply_snapshot(&mut self, payload: &Value, source: &SessionAddress, link_type: &str) {
        let session_id = first_str(payload, &["sessionID", "sessionId"])
            .or(source.session.as_deref())
            .unwrap_or("<unknown>");
        let runtime_id = first_str(payload, &["runtimeID", "runtimeId", "runtime"])
            .or(source.runtime.as_deref())
            .unwrap_or("<unknown>");
        let row = self.row_mut(runtime_id, session_id);
        row.summary = format!("{link_type}: {}", compact_json(payload, 120));
        row.detail = compact_json(payload, 1200);
        row.last_update = now_stamp();
    }

    fn row_mut(&mut self, runtime_id: &str, session_id: &str) -> &mut SessionRow {
        self.sessions
            .entry((runtime_id.into(), session_id.into()))
            .or_insert_with(|| SessionRow {
                runtime_id: runtime_id.into(),
                session_id: session_id.into(),
                state: "unknown".into(),
                ..Default::default()
            })
    }

    fn push_event(&mut self, event: String) {
        self.events.push(format!("{} {event}", now_stamp()));
        if self.events.len() > 8 {
            self.events.remove(0);
        }
    }

    #[cfg(test)]
    pub fn insert_for_test(&mut self, row: SessionRow) {
        self.sessions
            .insert((row.runtime_id.clone(), row.session_id.clone()), row);
    }
}

fn first_str<'a>(payload: &'a Value, fields: &[&str]) -> Option<&'a str> {
    fields
        .iter()
        .find_map(|field| payload.get(*field).and_then(Value::as_str))
}

fn payload_value(payload: &Payload) -> Value {
    match payload {
        Payload::Text(value) => value.clone(),
        other => serde_json::to_value(other).unwrap_or(Value::Null),
    }
}

fn route_target_address(target: &RouteTarget) -> SessionAddress {
    match target {
        RouteTarget::Address { address } => address.clone(),
        _ => SessionAddress::domain_only("typed"),
    }
}

fn compact_json(value: &Value, max: usize) -> String {
    let mut text = value.to_string();
    if text.len() > max {
        text.truncate(max.saturating_sub(3));
        text.push_str("...");
    }
    text
}

pub fn now_stamp() -> String {
    let duration = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}.{:03}", duration.as_secs(), duration.subsec_millis())
}
