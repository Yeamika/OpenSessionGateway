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
        "raw",
        serde_json::json!({"k": 1}),
    );
    assert_eq!(env.kind, "raw");
    assert!(!env.id.to_string().is_empty());
}

#[test]
fn session_envelope_serde_roundtrip() {
    let env = SessionEnvelope::new(
        SessionAddress::domain_only("src"),
        SessionAddress::domain_only("tgt"),
        "test.kind",
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
fn link_message_envelope_roundtrip() {
    let env = SessionEnvelope::new(
        SessionAddress::domain_only("src"),
        SessionAddress::domain_only("tgt"),
        "test",
        serde_json::json!(null),
    );
    let msg = LinkMessage::Envelope(env);
    let json = serde_json::to_string(&msg).unwrap();
    let de: LinkMessage = serde_json::from_str(&json).unwrap();
    match de {
        LinkMessage::Envelope(e) => assert_eq!(e.kind, "test"),
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
