//! OSGP envelope helpers
//!
//! This module provides wire-format helpers for the timer endpoint.
//!
//! ## Handshake migration
//!
//! - [`create_link_handshake`] is the vNext handshake using `LinkHandshake`
//!   (`protocol_version`, `peer_id`, `metadata`). This is the preferred path
//!   for new endpoints.
//! - [`create_hello_envelope`] is the legacy handshake using `HelloMessage`
//!   (`role`, `capabilities`, `addresses`). Kept for backward compatibility
//!   during the transition period; new code should use `create_link_handshake`.

use serde_json::{json, Value};
use uuid::Uuid;

use crate::config::Config;
use crate::timer_store::Timer;

/// Create a session address (JSON value).
fn address(domain: &str, runtime: &str, session: &str) -> Value {
    json!({
        "domain": domain,
        "runtime": runtime,
        "session": session
    })
}

/// Create a vNext `LinkHandshake` for the GV router connection.
///
/// Uses the new `LinkHandshake` wire format (`protocol_version`, `peer_id`,
/// `metadata`). Does **not** carry addresses or role-based capabilities;
/// those are sent via separate `Announce` messages after connection.
///
/// The `peer_id` is taken from `config.gv.peer_id` (falling back to
/// `config.gv.runtime_id` if not set).
pub fn create_link_handshake(config: &Config) -> Value {
    let peer_id = config
        .gv
        .peer_id
        .as_deref()
        .unwrap_or(&config.gv.runtime_id);
    json!({
        "protocolVersion": "osgp/1",
        "peerId": peer_id,
        "metadata": {
            "endpoint": "timer",
            "version": env!("CARGO_PKG_VERSION"),
            "capabilities": ["timer_endpoint", "timer_mcp", "timer_web"]
        }
    })
}

/// Create an `Announce` message for a session address.
///
/// Used after `LinkHandshake` to register the timer endpoint's address
/// with the router.
pub fn create_announce(config: &Config) -> Value {
    json!({
        "type": "announce",
        "address": address(&config.gv.domain, &config.gv.runtime_id, &config.gv.session_id),
        "distance": 0
    })
}

/// Create legacy hello message for GV router connection.
///
/// **Deprecated**: use [`create_link_handshake`] + [`create_announce`] instead.
/// Kept for backward compatibility during the transition period.
#[deprecated(note = "Use create_link_handshake + create_announce for new peers")]
pub fn create_hello_envelope(config: &Config) -> Value {
    json!({
        "nodeId": config.gv.runtime_id,
        "role": "endpoint",
        "addresses": [
            address(&config.gv.domain, &config.gv.runtime_id, &config.gv.session_id)
        ],
        "capabilities": ["timer_endpoint", "timer_mcp", "timer_web"]
    })
}

/// Create timer trigger control envelope (canonical `control/add_prompt`).
///
/// When a timer fires, the endpoint sends a `control/add_prompt` envelope
/// to the session that created the timer (timer.runtime_id / timer.session_id).
///
/// Payload is flat to match the opencode plugin `handleAddPrompt()` contract:
/// - `sessionID`: target session (from timer.owner)
/// - `msg`: the timer message
/// - `system`: optional system prompt with timer metadata
///
/// The `kind` field is required by the router's `SessionEnvelope` wire format.
pub fn create_timer_trigger_envelope(config: &Config, timer: &Timer) -> Value {
    json!({
        "type": "envelope",
        "id": Uuid::new_v4().to_string(),
        "kind": "control.add_prompt",
        "linkType": "control",
        "subtype": "add_prompt",
        "source": address(&config.gv.domain, &config.gv.source_runtime, &config.gv.source_session),
        "target": address(&config.gv.domain, &timer.runtime_id, &timer.session_id),
        "payload": {
            "sessionID": timer.session_id,
            "msg": timer.msg,
            "system": timer_system_prompt(timer)
        },
        "ttl": 32,
        "routeHops": []
    })
}

/// Generate system prompt for timer notification
fn timer_system_prompt(timer: &Timer) -> String {
    format!(
        "<timer>\n<TimerID>{}</TimerID>\n<TimerType>{:?}</TimerType>\n<Title>{}</Title>\n<TriggerAt>{}</TriggerAt>\n</timer>\n<content>\n{}\n</content>",
        timer.timer_id,
        timer.timer_type,
        timer.title,
        timer.trigger_at,
        timer.msg
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::default_config;
    use crate::timer_store::{Timer, TimerStatus, TimerType};

    fn test_timer() -> Timer {
        Timer {
            timer_id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            runtime_id: "test-runtime".to_string(),
            session_id: "test-session".to_string(),
            executor_runtime_id: "executor-runtime".to_string(),
            executor_session_id: "executor-session".to_string(),
            title: "Test Timer".to_string(),
            msg: "Hello from timer".to_string(),
            timer_type: TimerType::OneShot,
            delay_seconds: 60,
            every_seconds: None,
            cron_expr: None,
            created_at: "2026-05-27T00:00:00Z".to_string(),
            trigger_at: "2026-05-27T00:01:00Z".to_string(),
            status: TimerStatus::Pending,
        }
    }

    #[test]
    fn test_create_hello_envelope() {
        let config = default_config();
        let hello = create_hello_envelope(&config);

        assert_eq!(hello["nodeId"], "timer-endpoint");
        assert_eq!(hello["role"], "endpoint");
        assert!(hello["addresses"].is_array());
        assert_eq!(hello["addresses"][0]["domain"], "domain-a");
    }

    #[test]
    fn test_create_timer_trigger_envelope() {
        let config = default_config();
        let timer = test_timer();
        let envelope = create_timer_trigger_envelope(&config, &timer);

        assert_eq!(envelope["type"], "envelope");
        assert_eq!(envelope["kind"], "control.add_prompt");
        assert_eq!(envelope["linkType"], "control");
        assert_eq!(envelope["subtype"], "add_prompt");
        assert!(envelope["id"].is_string());
        assert!(envelope["source"].is_object());
        assert!(envelope["target"].is_object());
        // Target must be the caller/owner session (from timer), not config default
        assert_eq!(envelope["target"]["runtime"], "test-runtime");
        assert_eq!(envelope["target"]["session"], "test-session");
        // Flat payload — matches opencode plugin handleAddPrompt() contract
        assert_eq!(envelope["payload"]["sessionID"], "test-session");
        assert_eq!(envelope["payload"]["msg"], "Hello from timer");
        assert!(envelope["payload"]["system"].is_string());
    }

    // ── LinkHandshake (vNext) tests ──────────────────────────────────

    #[test]
    fn test_create_link_handshake_default_peer_id() {
        let config = default_config();
        let hs = create_link_handshake(&config);

        assert_eq!(hs["protocolVersion"], "osgp/1");
        assert_eq!(hs["peerId"], "timer-endpoint"); // falls back to runtime_id
        assert!(hs["metadata"].is_object());
        assert_eq!(hs["metadata"]["endpoint"], "timer");
        assert!(hs["metadata"]["capabilities"].is_array());
    }

    #[test]
    fn test_create_link_handshake_custom_peer_id() {
        let mut config = default_config();
        config.gv.peer_id = Some("custom-timer-peer".to_string());
        let hs = create_link_handshake(&config);

        assert_eq!(hs["protocolVersion"], "osgp/1");
        assert_eq!(hs["peerId"], "custom-timer-peer");
    }

    #[test]
    fn test_create_link_handshake_no_legacy_fields() {
        let config = default_config();
        let hs = create_link_handshake(&config);

        // LinkHandshake must NOT contain legacy fields
        assert!(
            hs.get("role").is_none(),
            "LinkHandshake must not have 'role'"
        );
        assert!(
            hs.get("nodeId").is_none(),
            "LinkHandshake must not have 'nodeId'"
        );
        assert!(
            hs.get("addresses").is_none(),
            "LinkHandshake must not have 'addresses'"
        );
        assert!(
            hs.get("capabilities").is_none(),
            "LinkHandshake must not have top-level 'capabilities'"
        );
    }

    #[test]
    fn test_create_link_handshake_parses_as_osgp_link_handshake() {
        let config = default_config();
        let hs = create_link_handshake(&config);

        // Must deserialize as osgp::LinkHandshake
        let parsed: osgp::LinkHandshake =
            serde_json::from_value(hs).expect("should parse as LinkHandshake");
        assert_eq!(parsed.protocol_version, "osgp/1");
        assert_eq!(parsed.peer_id, "timer-endpoint");
        assert!(parsed.metadata.is_some());
    }

    #[test]
    fn test_create_link_handshake_handshake_kind_detection() {
        let config = default_config();
        let hs = create_link_handshake(&config);
        let hs_str = serde_json::to_string(&hs).unwrap();

        // Router uses HandshakeKind (untagged) to detect which variant
        let kind: osgp::HandshakeKind =
            serde_json::from_str(&hs_str).expect("should parse as HandshakeKind");
        match kind {
            osgp::HandshakeKind::Link(h) => {
                assert_eq!(h.protocol_version, "osgp/1");
                assert_eq!(h.peer_id, "timer-endpoint");
            }
            osgp::HandshakeKind::Hello(_) => {
                panic!("LinkHandshake should parse as Link variant, not Hello");
            }
        }
    }

    #[test]
    fn test_create_announce() {
        let config = default_config();
        let ann = create_announce(&config);

        assert_eq!(ann["type"], "announce");
        assert_eq!(ann["address"]["domain"], "domain-a");
        assert_eq!(ann["address"]["runtime"], "timer-endpoint");
        assert_eq!(ann["address"]["session"], "timer");
        assert_eq!(ann["distance"], 0);
    }

    #[test]
    fn test_announce_serializes_as_link_message() {
        let config = default_config();
        let ann = create_announce(&config);
        let ann_str = serde_json::to_string(&ann).unwrap();

        // Should parse as LinkMessage::Announce
        let msg: osgp::LinkMessage =
            serde_json::from_str(&ann_str).expect("should parse as LinkMessage");
        match msg {
            osgp::LinkMessage::Announce { address, distance } => {
                assert_eq!(address.domain, "domain-a");
                assert_eq!(distance, 0);
            }
            other => panic!("expected Announce, got {:?}", other),
        }
    }
}
