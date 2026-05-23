use super::*;
use osgp::SessionEnvelope;
use serde_json::json;
use uuid::Uuid;

fn endpoint_addr() -> SessionAddress {
    SessionAddress::new(
        "control-domain",
        Some("control-rt".into()),
        Some("control-ses".into()),
    )
}

fn target_addr() -> SessionAddress {
    SessionAddress::new(
        "target-domain",
        Some("target-rt".into()),
        Some("target-ses".into()),
    )
}

#[test]
fn addprompt_envelope_shape() {
    let cs = ControlSurface::new("ctrl-1", endpoint_addr());
    let env = cs.build_addprompt(target_addr(), "Hello!", Some("sys"), Some("src"));

    assert_eq!(env.kind, "session_command");
    assert_eq!(env.source.domain, "control-domain");
    assert_eq!(env.target.domain, "target-domain");
    assert_eq!(env.ttl, 32);

    let cmd: ControlCommand = serde_json::from_value(env.payload).unwrap();
    match cmd {
        ControlCommand::AddPrompt {
            session_id,
            msg,
            system,
            source,
        } => {
            assert_eq!(session_id, "target-ses");
            assert_eq!(msg, "Hello!");
            assert_eq!(system.as_deref(), Some("sys"));
            assert_eq!(source.as_deref(), Some("src"));
        }
        other => panic!("expected AddPrompt, got: {:?}", other),
    }
}

#[test]
fn abort_envelope_shape() {
    let cs = ControlSurface::new("ctrl-1", endpoint_addr());
    let env = cs.build_abort(target_addr(), Some("timeout"));

    assert_eq!(env.kind, "session_command");
    let cmd: ControlCommand = serde_json::from_value(env.payload).unwrap();
    match cmd {
        ControlCommand::AbortSession { session_id, reason } => {
            assert_eq!(session_id, "target-ses");
            assert_eq!(reason.as_deref(), Some("timeout"));
        }
        other => panic!("expected Abort, got: {:?}", other),
    }
}

#[test]
fn compact_envelope_shape() {
    let cs = ControlSurface::new("ctrl-1", endpoint_addr());
    let env = cs.build_compact(target_addr(), Some(true));

    let cmd: ControlCommand = serde_json::from_value(env.payload).unwrap();
    match cmd {
        ControlCommand::CompactSession { session_id, auto } => {
            assert_eq!(session_id, "target-ses");
            assert_eq!(auto, Some(true));
        }
        other => panic!("expected Compact, got: {:?}", other),
    }
}

#[test]
fn parse_response_from_envelope() {
    let response_payload = json!({
        "command": "addprompt",
        "success": true,
        "message": "done",
        "data": {"result": "ok"}
    });

    let reply = SessionEnvelope {
        id: Uuid::new_v4(),
        source: target_addr(),
        target: endpoint_addr(),
        link_type: "response".to_string(),
        subtype: "add_prompt".to_string(),
        kind: "control.response".to_string(),
        payload: response_payload,
        ttl: 32,
        route_hops: vec![],
        origin_surface: None,
    };

    let resp = ControlSurface::parse_response(&reply).expect("should parse");
    assert_eq!(resp.command, "addprompt");
    assert!(resp.success);
    assert_eq!(resp.message.as_deref(), Some("done"));
}

#[test]
fn control_command_addprompt_serialization() {
    let cmd = ControlCommand::AddPrompt {
        session_id: "s1".to_string(),
        msg: "test".to_string(),
        system: None,
        source: None,
    };
    let json = serde_json::to_string(&cmd).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed["command"], "add_prompt");
    assert_eq!(parsed["sessionID"], "s1");
    assert_eq!(parsed["msg"], "test");
}

#[test]
fn control_command_abort_no_reason() {
    let cmd = ControlCommand::AbortSession {
        session_id: "s1".to_string(),
        reason: None,
    };
    let json_str = serde_json::to_string(&cmd).unwrap();
    assert!(json_str.contains("\"command\":\"abort_session\""));
    assert!(!json_str.contains("\"reason\""));
}

#[test]
fn envelope_has_no_origin_surface() {
    let cs = ControlSurface::new("ctrl-1", endpoint_addr());
    let env = cs.build_addprompt(target_addr(), "Hello!", None::<String>, None::<String>);

    assert!(env.origin_surface.is_none());
}

#[test]
fn envelope_source_address_preserved() {
    let cs = ControlSurface::new("ctrl-1", endpoint_addr());
    let env = cs.build_addprompt(target_addr(), "Hello!", None::<String>, None::<String>);

    assert_eq!(env.source.domain, "control-domain");
    assert_eq!(env.source.runtime.as_deref(), Some("control-rt"));
    assert_eq!(env.source.session.as_deref(), Some("control-ses"));
}
