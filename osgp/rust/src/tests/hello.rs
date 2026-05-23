//! Tests for Hello handshake types.

use crate::*;

#[test]
fn hello_message_serde_roundtrip() {
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
