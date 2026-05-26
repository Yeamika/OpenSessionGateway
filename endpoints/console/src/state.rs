use std::collections::BTreeMap;

use osgp::{
    Envelope, LinkType, Payload, ReadResponse, RouteTarget, SessionAddress, SessionEnvelope,
};
use serde_json::Value;

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
}

impl ConsoleState {
    pub fn apply_session_envelope(&mut self, envelope: &SessionEnvelope) {
        match envelope.link_type.as_str() {
            "upload" => self.apply_upload(&envelope.subtype, &envelope.payload, &envelope.source),
            "response" | "request" => {
                self.apply_snapshot(&envelope.payload, &envelope.source, &envelope.link_type)
            }
            _ => {}
        }
        self.push_event(format!("{} {}", envelope.link_type, envelope.subtype));
    }

    pub fn apply_typed_envelope(&mut self, envelope: &Envelope) {
        let payload = payload_value(&envelope.payload);
        let source = route_target_address(&envelope.source);
        match envelope.link_type {
            LinkType::Upload => self.apply_upload(&envelope.subtype, &payload, &source),
            LinkType::Response | LinkType::Request => {
                self.apply_snapshot(&payload, &source, envelope.link_type.as_wire())
            }
            _ => {}
        }
        self.push_event(format!(
            "{} {}",
            envelope.link_type.as_wire(),
            envelope.subtype
        ));
    }

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

    fn apply_upload(&mut self, subtype: &str, payload: &Value, source: &SessionAddress) {
        match subtype {
            "session_update" => self.apply_session_update(payload, source),
            "requestion_asked" | "requestion_updated" => {
                self.upsert_requestion(payload, source, subtype)
            }
            "requestion_resolved" | "requestion_cancelled" => {
                self.resolve_requestion(payload, source)
            }
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
