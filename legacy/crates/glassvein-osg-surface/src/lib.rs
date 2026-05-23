//! GlassVein OSG Surface — subscribe to GlassVein `/glassvein/observe`
//! and parse OSG session updates in-surface.
//!
//! The observe WebSocket sends two kinds of messages:
//!
//! 1. `GlassVeinObserveHello` — handshake hello, ignored by the surface.
//! 2. `GlassVeinObservation` — an observed frame. For `opcode: "text"`
//!    observations the `text` field carries raw JSON that the surface
//!    parses itself. When the raw JSON has
//!    `type == "ClientContentExecuteing"` and `data.session` is an object,
//!    we surface an `OsgSessionUpdate`.
//!
//! # Control Surface
//!
//! The control surface connects to a GlassVein router as a `Surface` role
//! and can send targeted control commands (e.g., `addprompt`) to specific
//! runtime/session addresses.
//!
//! # Observe protocol (router schema)
//!
//! ```json
//! // Hello (ignored)
//! { "type": "GlassVeinObserveHello", "observe": "glassvein" }
//!
//! // Text observation
//! {
//!   "type": "GlassVeinObservation",
//!   "connectionID": "conn-1",
//!   "direction": "downstream_to_upstream",
//!   "path": "/api/ws",
//!   "query": "token=abc",
//!   "opcode": "text",
//!   "text": "{\"type\":\"ClientContentExecuteing\", ...}",
//!   "byteLength": null,
//!   "observedAt": 1234567890.123
//! }
//! ```

mod control;
pub use control::{
    ControlCommand, ControlResponse, ControlSurface, ControlSurfaceConfig,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;

// ───────────────────────────── Types ─────────────────────────────

/// An observation received from the `/glassvein/observe` WebSocket.
///
/// Matches the router's finalized schema — see `glassvein-router` `observe.rs`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlassVeinObservation {
    /// Message type. Expected: `"GlassVeinObservation"`.
    #[serde(rename = "type")]
    pub msg_type: String,

    /// Connection identifier from the router.
    #[serde(rename = "connectionID", default)]
    pub connection_id: Option<String>,

    /// Direction of the observed frame (e.g. `"downstream_to_upstream"`).
    #[serde(default)]
    pub direction: Option<String>,

    /// Downstream request path.
    #[serde(default)]
    pub path: Option<String>,

    /// Downstream query string, if any.
    #[serde(default)]
    pub query: Option<String>,

    /// Observation opcode — `"text"` for raw JSON payloads.
    #[serde(default)]
    pub opcode: Option<String>,

    /// Raw text content. For `opcode == "text"` this is a JSON string
    /// whose contents the surface parses itself.
    #[serde(default)]
    pub text: Option<String>,

    /// Byte length for binary/ping/pong frames.
    #[serde(default)]
    pub byte_length: Option<usize>,

    /// Epoch-seconds timestamp when the observation was made.
    #[serde(default)]
    pub observed_at: Option<f64>,
}

/// A parsed OSG session update surfaced from a text observation.
///
/// This is the structured output produced when `--json` is passed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsgSessionUpdate {
    /// Always `"GlassVeinOsgSessionUpdate"`.
    #[serde(rename = "type")]
    pub msg_type: String,

    /// Direction from the original observation.
    #[serde(default)]
    pub direction: Option<String>,

    /// Epoch-seconds when the observation was captured.
    #[serde(default)]
    pub observed_at: Option<f64>,

    /// `requestID` from the inner raw JSON, if present.
    #[serde(default)]
    pub request_id: Option<Value>,

    /// The `data` object from the inner raw JSON.
    pub data: Value,

    /// The `session` sub-object extracted from `data.session`.
    pub session: Value,
}

// ───────────────────────────── Parsing ───────────────────────────

/// Try to extract an [`OsgSessionUpdate`] from a [`GlassVeinObservation`].
///
/// Returns `None` when:
/// - The observation opcode is not `"text"`.
/// - The `text` field is missing or not valid JSON.
/// - The inner JSON `type` is not `"ClientContentExecuteing"`.
/// - The inner JSON `data.session` is not an object.
pub fn try_parse_session_update(obs: &GlassVeinObservation) -> Option<OsgSessionUpdate> {
    // Only text observations carry parseable payloads.
    if obs.opcode.as_deref() != Some("text") {
        return None;
    }

    let raw = obs.text.as_ref()?;
    let inner: Value = serde_json::from_str(raw).ok()?;

    let msg_type = inner.get("type")?.as_str()?;
    if msg_type != "ClientContentExecuteing" {
        return None;
    }

    let data = inner.get("data")?;
    let session = data.get("session")?;
    if !session.is_object() {
        return None;
    }

    let request_id = inner.get("requestID").cloned();

    Some(OsgSessionUpdate {
        msg_type: "GlassVeinOsgSessionUpdate".to_string(),
        direction: obs.direction.clone(),
        observed_at: obs.observed_at,
        request_id,
        data: data.clone(),
        session: session.clone(),
    })
}

/// Format a concise human-readable line for an [`OsgSessionUpdate`].
pub fn format_concise(update: &OsgSessionUpdate) -> String {
    let direction = update.direction.as_deref().unwrap_or("-");
    let session_id = update
        .session
        .get("id")
        .or_else(|| update.session.get("sessionId"))
        .or_else(|| update.session.get("sessionID"))
        .and_then(|v| v.as_str())
        .unwrap_or("-");
    let title = update
        .session
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("-");
    let state = update
        .session
        .get("state")
        .and_then(|v| v.as_str())
        .unwrap_or("-");

    let time = update
        .observed_at
        .map(|t| format!("{t:.3}"))
        .unwrap_or_else(|| "-".to_string());

    format!(
        "[{time}] {direction} ClientContentExecuteing session={session_id} title=\"{title}\" state={state}"
    )
}

// ───────────────────────────── Tests ─────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn make_text_observation(direction: &str, raw_json: &str) -> GlassVeinObservation {
        GlassVeinObservation {
            msg_type: "GlassVeinObservation".to_string(),
            connection_id: Some("conn-1".to_string()),
            direction: Some(direction.to_string()),
            path: Some("/api/ws".to_string()),
            query: None,
            opcode: Some("text".to_string()),
            text: Some(raw_json.to_string()),
            byte_length: None,
            observed_at: Some(1700000000.0),
        }
    }

    // ── Happy path: matching session update ──

    #[test]
    fn parse_session_update_from_matching_observation() {
        let raw = r#"{"type":"ClientContentExecuteing","requestID":"req-42","data":{"session":{"id":"s1","title":"Demo","state":"running"},"content":"hello"}}"#;
        let obs = make_text_observation("downstream_to_upstream", raw);

        let update = try_parse_session_update(&obs).expect("should parse");
        assert_eq!(update.msg_type, "GlassVeinOsgSessionUpdate");
        assert_eq!(update.direction.as_deref(), Some("downstream_to_upstream"));
        assert_eq!(update.observed_at, Some(1700000000.0));
        assert_eq!(update.request_id, Some(json!("req-42")));
        assert_eq!(update.session["id"], "s1");
        assert_eq!(update.data["content"], "hello");
    }

    // ── Wrong inner type ──

    #[test]
    fn ignore_wrong_inner_type() {
        let raw = r#"{"type":"SomeOtherMessage","data":{"session":{"id":"s1"}}}"#;
        let obs = make_text_observation("downstream_to_upstream", raw);
        assert!(try_parse_session_update(&obs).is_none());
    }

    // ── Missing session object ──

    #[test]
    fn ignore_missing_session_object() {
        let raw = r#"{"type":"ClientContentExecuteing","data":{"content":"hello"}}"#;
        let obs = make_text_observation("downstream_to_upstream", raw);
        assert!(try_parse_session_update(&obs).is_none());
    }

    // ── Session is not an object ──

    #[test]
    fn ignore_session_not_object() {
        let raw = r#"{"type":"ClientContentExecuteing","data":{"session":"string-id"}}"#;
        let obs = make_text_observation("downstream_to_upstream", raw);
        assert!(try_parse_session_update(&obs).is_none());
    }

    // ── Non-text observation ──

    #[test]
    fn ignore_non_text_observation() {
        let obs = GlassVeinObservation {
            msg_type: "GlassVeinObservation".to_string(),
            connection_id: Some("conn-1".to_string()),
            direction: Some("downstream_to_upstream".to_string()),
            path: Some("/api/ws".to_string()),
            query: None,
            opcode: Some("binary".to_string()),
            text: Some(
                r#"{"type":"ClientContentExecuteing","data":{"session":{"id":"s1"}}}"#.to_string(),
            ),
            byte_length: Some(100),
            observed_at: None,
        };
        assert!(try_parse_session_update(&obs).is_none());
    }

    // ── Missing opcode entirely ──

    #[test]
    fn ignore_observation_without_opcode() {
        let obs = GlassVeinObservation {
            msg_type: "GlassVeinObservation".to_string(),
            connection_id: None,
            direction: None,
            path: None,
            query: None,
            opcode: None,
            text: Some(
                r#"{"type":"ClientContentExecuteing","data":{"session":{"id":"s1"}}}"#.to_string(),
            ),
            byte_length: None,
            observed_at: None,
        };
        assert!(try_parse_session_update(&obs).is_none());
    }

    // ── Missing text field ──

    #[test]
    fn ignore_observation_without_text() {
        let obs = GlassVeinObservation {
            msg_type: "GlassVeinObservation".to_string(),
            connection_id: None,
            direction: None,
            path: None,
            query: None,
            opcode: Some("text".to_string()),
            text: None,
            byte_length: None,
            observed_at: None,
        };
        assert!(try_parse_session_update(&obs).is_none());
    }

    // ── Invalid JSON in text ──

    #[test]
    fn ignore_invalid_json_in_text() {
        let obs = make_text_observation("downstream_to_upstream", "not json at all");
        assert!(try_parse_session_update(&obs).is_none());
    }

    // ── Missing data field ──

    #[test]
    fn ignore_missing_data_field() {
        let raw = r#"{"type":"ClientContentExecuteing"}"#;
        let obs = make_text_observation("downstream_to_upstream", raw);
        assert!(try_parse_session_update(&obs).is_none());
    }

    // ── Concise formatting ──

    #[test]
    fn concise_format_contains_key_fields() {
        let update = OsgSessionUpdate {
            msg_type: "GlassVeinOsgSessionUpdate".to_string(),
            direction: Some("upstream_to_downstream".to_string()),
            observed_at: Some(1700000000.0),
            request_id: Some(json!("r1")),
            data: json!({"session": {"id": "s1", "title": "Test", "state": "active"}}),
            session: json!({"id": "s1", "title": "Test", "state": "active"}),
        };
        let line = format_concise(&update);
        assert!(line.contains("upstream_to_downstream"));
        assert!(line.contains("session=s1"));
        assert!(line.contains("title=\"Test\""));
        assert!(line.contains("state=active"));
    }

    // ── Deserialization from raw JSON (router wire format) ──

    #[test]
    fn deserialize_observation_from_json() {
        let json_str = r#"{
            "type": "GlassVeinObservation",
            "connectionID": "conn-42",
            "direction": "downstream_to_upstream",
            "path": "/api/ws",
            "query": "token=abc",
            "opcode": "text",
            "text": "{\"type\":\"ClientContentExecuteing\",\"data\":{\"session\":{\"id\":\"s1\"}}}",
            "byteLength": null,
            "observedAt": 1700000000.0
        }"#;
        let obs: GlassVeinObservation = serde_json::from_str(json_str).unwrap();
        assert_eq!(obs.msg_type, "GlassVeinObservation");
        assert_eq!(obs.connection_id.as_deref(), Some("conn-42"));
        assert_eq!(obs.opcode.as_deref(), Some("text"));
        assert_eq!(obs.path.as_deref(), Some("/api/ws"));
        assert_eq!(obs.query.as_deref(), Some("token=abc"));
        assert!(try_parse_session_update(&obs).is_some());
    }

    // ── Hello message should not parse as observation ──

    #[test]
    fn hello_message_deserialization() {
        let json_str = r#"{"type":"GlassVeinObserveHello","observe":"glassvein"}"#;
        // Hello is a different type; it can be deserialized but won't be
        // "GlassVeinObservation" so callers filter by msg_type.
        let val: Value = serde_json::from_str(json_str).unwrap();
        assert_eq!(val["type"], "GlassVeinObserveHello");
    }
}
