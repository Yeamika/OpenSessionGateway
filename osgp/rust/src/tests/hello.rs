//! Tests for Hello handshake types.

use crate::*;

#[test]
fn hello_message_serde_roundtrip() {
    #[allow(deprecated)]
    let hello = HelloMessage {
        node_id: "node-1".into(),
        role: Role::Endpoint,
        addresses: vec![SessionAddress::domain_only("dom")],
        capabilities: vec!["surface_viewer".into()],
    };

    let json = serde_json::to_string(&hello).unwrap();
    assert!(json.contains("nodeId"));
    assert!(json.contains("endpoint"));

    let de: HelloMessage = serde_json::from_str(&json).unwrap();
    assert_eq!(de.node_id, "node-1");
    assert_eq!(de.addresses.len(), 1);
    assert_eq!(de.capabilities, vec!["surface_viewer"]);
}

#[test]
fn link_handshake_serde_roundtrip() {
    let hs = LinkHandshake::new("peer-1");
    let json = serde_json::to_string(&hs).unwrap();
    assert!(json.contains("protocolVersion"));
    assert!(json.contains("osgp/1"));
    assert!(json.contains("peerId"));
    assert!(!json.contains("metadata")); // skip_serializing_if None

    let de: LinkHandshake = serde_json::from_str(&json).unwrap();
    assert_eq!(de.peer_id, "peer-1");
    assert_eq!(de.protocol_version, "osgp/1");
    assert!(de.metadata.is_none());
}

#[test]
fn link_handshake_with_metadata() {
    let hs = LinkHandshake::new("peer-2")
        .with_metadata(serde_json::json!({"auth": "token-abc"}));
    let json = serde_json::to_string(&hs).unwrap();
    assert!(json.contains("metadata"));

    let de: LinkHandshake = serde_json::from_str(&json).unwrap();
    assert_eq!(de.metadata.unwrap()["auth"], "token-abc");
}

#[test]
fn handshake_kind_parses_link_handshake() {
    let hs = LinkHandshake::new("peer-new");
    let json = serde_json::to_string(&hs).unwrap();

    let kind: HandshakeKind = serde_json::from_str(&json).unwrap();
    match kind {
        HandshakeKind::Link(h) => assert_eq!(h.peer_id, "peer-new"),
        _ => panic!("expected Link variant"),
    }
}

#[test]
fn handshake_kind_parses_hello_message() {
    #[allow(deprecated)]
    let hello = HelloMessage {
        node_id: "peer-old".into(),
        role: Role::Router,
        addresses: vec![],
        capabilities: vec![],
    };
    let json = serde_json::to_string(&hello).unwrap();

    let kind: HandshakeKind = serde_json::from_str(&json).unwrap();
    match kind {
        HandshakeKind::Hello(h) => assert_eq!(h.node_id, "peer-old"),
        _ => panic!("expected Hello variant"),
    }
}
