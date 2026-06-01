//! Tests for envelope types and LinkMessage.

use crate::*;

fn src() -> RouteTarget {
    RouteTarget::address(SessionAddress::new("src", None::<String>, None::<String>))
}

fn tgt() -> RouteTarget {
    RouteTarget::address(SessionAddress::new("tgt", None::<String>, None::<String>))
}

#[test]
fn session_envelope_new_has_canonical_fields() {
    let env = SessionEnvelope::new(
        SessionAddress::domain_only("src"),
        SessionAddress::domain_only("tgt"),
        "session_update",
        serde_json::json!({"k": 1}),
    );
    assert_eq!(env.kind, "session_update");
    assert_eq!(env.link_type, "upload");
    assert_eq!(env.subtype, "session_update");
    assert!(!env.id.to_string().is_empty());
}

#[test]
fn session_envelope_validate_accepts_canonical() {
    let env = SessionEnvelope::new(
        SessionAddress::domain_only("src"),
        SessionAddress::domain_only("tgt"),
        "session_update",
        serde_json::json!({}),
    );
    assert!(env.validate().is_ok());
}

#[test]
fn session_envelope_validate_rejects_unknown_subtype() {
    let env = SessionEnvelope::new(
        SessionAddress::domain_only("src"),
        SessionAddress::domain_only("tgt"),
        "im_gateway.message",
        serde_json::json!({}),
    );
    // Pass-through maps to ("im_gateway.message", "im_gateway.message") which is not canonical
    let err = env.validate().unwrap_err();
    match err {
        ValidationError::UnknownSubtype { link_type, subtype } => {
            assert_eq!(link_type, "im_gateway.message");
            assert_eq!(subtype, "im_gateway.message");
        }
        other => panic!("expected UnknownSubtype, got: {other:?}"),
    }
}

#[test]
fn session_envelope_validate_rejects_timer_fired() {
    let env = SessionEnvelope::new(
        SessionAddress::domain_only("src"),
        SessionAddress::domain_only("tgt"),
        "timer.fired",
        serde_json::json!({}),
    );
    let err = env.validate().unwrap_err();
    assert!(matches!(err, ValidationError::UnknownSubtype { .. }));
}

#[test]
fn session_envelope_serde_roundtrip() {
    let env = SessionEnvelope::new(
        SessionAddress::domain_only("src"),
        SessionAddress::domain_only("tgt"),
        "session_update",
        serde_json::json!({"val": 42}),
    );
    let json = serde_json::to_string(&env).unwrap();
    let de: SessionEnvelope = serde_json::from_str(&json).unwrap();
    assert_eq!(de.id, env.id);
    assert_eq!(de.kind, env.kind);
}

#[test]
fn envelope_new_typed() {
    let env = Envelope::new(
        src(),
        tgt(),
        Payload::SessionUpdate(SessionUpdate {
            session_id: SessionId::new("s1"),
            state: SessionState::Active,
            title: None,
            summary: None,
            metadata: None,
        }),
    );
    assert!(matches!(env.link_type, LinkType::Upload));
    assert_eq!(env.subtype, "session_update");
}

#[test]
fn envelope_new_with_optional_fields() {
    let env = Envelope::new(
        src(),
        tgt(),
        Payload::SessionUpdate(SessionUpdate {
            session_id: "s1".into(),
            state: SessionState::Running,
            title: Some("Test Session".into()),
            summary: Some("A test".into()),
            metadata: Some(serde_json::json!({"meta": true})),
        }),
    );
    assert!(matches!(env.link_type, LinkType::Upload));
}

#[test]
fn envelope_serde_roundtrip() {
    let env = Envelope::new(
        src(),
        tgt(),
        Payload::SessionCommand(SessionCommand {
            command: "add_prompt".into(),
            subtype: SessionCommandKind::AddPrompt {
                session_id: SessionId::new("s1"),
            },
            payload: serde_json::json!({"text": "hello"}),
        }),
    );
    let json = serde_json::to_string(&env).unwrap();
    let de: Envelope = serde_json::from_str(&json).unwrap();
    assert_eq!(de.message_id, env.message_id);
    assert_eq!(de.subtype, "add_prompt");
}

#[test]
fn envelope_validate_accepts_canonical_control() {
    let env = Envelope::new(
        src(),
        tgt(),
        Payload::SessionCommand(SessionCommand {
            command: "add_prompt".into(),
            subtype: SessionCommandKind::AddPrompt {
                session_id: SessionId::new("s1"),
            },
            payload: serde_json::json!({}),
        }),
    );
    assert!(env.validate().is_ok());
}

#[test]
fn link_message_envelope_roundtrip() {
    let env = SessionEnvelope::new(
        SessionAddress::domain_only("src"),
        SessionAddress::domain_only("tgt"),
        "session_update",
        serde_json::json!(null),
    );
    let msg = LinkMessage::Envelope(env);
    let json = serde_json::to_string(&msg).unwrap();
    let de: LinkMessage = serde_json::from_str(&json).unwrap();
    match de {
        LinkMessage::Envelope(e) => assert_eq!(e.kind, "session_update"),
        other => panic!("expected Envelope, got {:?}", other),
    }
}

#[test]
fn link_message_typed_envelope_roundtrip() {
    let env = Envelope::new(
        src(),
        tgt(),
        Payload::SessionCommand(SessionCommand {
            command: "add_prompt".into(),
            subtype: SessionCommandKind::AddPrompt {
                session_id: SessionId::new("s1"),
            },
            payload: serde_json::json!({}),
        }),
    );
    let msg = LinkMessage::TypedEnvelope(env);
    let json = serde_json::to_string(&msg).unwrap();
    let de: LinkMessage = serde_json::from_str(&json).unwrap();
    match de {
        LinkMessage::TypedEnvelope(e) => assert_eq!(e.subtype, "add_prompt"),
        other => panic!("expected TypedEnvelope, got {:?}", other),
    }
}

#[test]
fn link_message_ping_pong_roundtrip() {
    let json = serde_json::to_string(&LinkMessage::Ping).unwrap();
    assert!(json.contains("\"ping\""));
    let de: LinkMessage = serde_json::from_str(&json).unwrap();
    assert!(matches!(de, LinkMessage::Ping));

    let json = serde_json::to_string(&LinkMessage::Pong).unwrap();
    assert!(json.contains("\"pong\""));
    let de: LinkMessage = serde_json::from_str(&json).unwrap();
    assert!(matches!(de, LinkMessage::Pong));
}

#[test]
fn link_message_announce_roundtrip() {
    let msg = LinkMessage::Announce {
        address: SessionAddress::domain_only("d1"),
        distance: 0,
    };
    let json = serde_json::to_string(&msg).unwrap();
    let de: LinkMessage = serde_json::from_str(&json).unwrap();
    match de {
        LinkMessage::Announce { address, distance } => {
            assert_eq!(address.domain, "d1");
            assert_eq!(distance, 0);
        }
        other => panic!("expected Announce, got {:?}", other),
    }
}

// ── Mailbox reminder scenario ────────────────────────────────────────
//
// Mailbox endpoint outbound reminders use control/add_prompt.
// No new subtypes like mailbox.reminder, MailboxReminders, need_replay are allowed.

#[test]
fn mailbox_reminder_as_control_add_prompt() {
    // Mailbox reminder must use control/add_prompt
    let env = SessionEnvelope::new(
        SessionAddress::domain_only("src"),
        SessionAddress::domain_only("tgt"),
        "control.add_prompt",
        serde_json::json!({"subtype": "add_prompt", "session_id": "s1"}),
    );
    assert_eq!(env.link_type, "control");
    assert_eq!(env.subtype, "add_prompt");
    assert!(env.validate().is_ok());
}

#[test]
fn mailbox_reminder_typed_envelope() {
    // Mailbox reminder as typed envelope
    let env = Envelope::new(
        src(),
        tgt(),
        Payload::SessionCommand(SessionCommand {
            command: "add_prompt".into(),
            subtype: SessionCommandKind::AddPrompt {
                session_id: SessionId::new("s1"),
            },
            payload: serde_json::json!({"text": "reminder"}),
        }),
    );
    assert_eq!(env.link_type, LinkType::Control);
    assert_eq!(env.subtype, "add_prompt");
    assert!(env.validate().is_ok());
}

#[test]
fn mailbox_dynamic_subtype_rejected() {
    // Dynamic mailbox subtypes must be rejected
    let env = SessionEnvelope::new(
        SessionAddress::domain_only("src"),
        SessionAddress::domain_only("tgt"),
        "mailbox.reminder",
        serde_json::json!({}),
    );
    let err = env.validate().unwrap_err();
    assert!(matches!(err, ValidationError::UnknownSubtype { .. }));
}

#[test]
fn mailbox_need_replay_subtype_rejected() {
    // need_replay is not a canonical subtype
    let env = SessionEnvelope::new(
        SessionAddress::domain_only("src"),
        SessionAddress::domain_only("tgt"),
        "control.need_replay",
        serde_json::json!({"subtype": "need_replay"}),
    );
    // control.need_replay maps to ("control", "need_replay") which is not canonical
    let err = env.validate().unwrap_err();
    assert!(matches!(err, ValidationError::UnknownSubtype { .. }));
}

#[test]
fn mailbox_response_mirror_accepted() {
    // response/add_prompt is accepted as mirror of control/add_prompt
    let response = crate::read::ReadResponse::ok_for_request(
        &SessionAddress::domain_only("responder"),
        &crate::read::ReadRequest::new(
            SessionAddress::domain_only("src"),
            SessionAddress::domain_only("tgt"),
            crate::read::ReadOperation::RuntimeSessionMessages {
                runtime_id: "rt1".into(),
                session_id: SessionId::new("s1"),
                anchor_time: None,
                limit: None,
                regex: None,
            },
        ),
        serde_json::json!({"status": "ok"}),
    );
    // Response subtype mirrors request subtype
    assert_eq!(response.subtype, "runtime_session_messages");
    assert_eq!(response.link_type, "response");
}
