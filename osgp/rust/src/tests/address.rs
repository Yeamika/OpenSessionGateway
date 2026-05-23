//! Tests for address types.

use crate::*;

#[test]
fn session_address_serde_roundtrip() {
    let addr = SessionAddress::new("dom", Some("rt".into()), Some("ses".into()));
    let json = serde_json::to_string(&addr).unwrap();
    assert!(json.contains("\"domain\""));
    let de: SessionAddress = serde_json::from_str(&json).unwrap();
    assert_eq!(de, addr);
}

#[test]
fn session_address_optional_fields_omitted() {
    let addr = SessionAddress::domain_only("dom");
    let json = serde_json::to_string(&addr).unwrap();
    assert!(!json.contains("runtime"));
    assert!(!json.contains("session"));
}

#[test]
fn route_target_address() {
    let rt = RouteTarget::address(SessionAddress::new("d", None::<String>, None::<String>));
    let json = serde_json::to_string(&rt).unwrap();
    let de: RouteTarget = serde_json::from_str(&json).unwrap();
    assert_eq!(de, rt);
}

#[test]
fn route_target_session() {
    let rt = RouteTarget::session("node-1", "ses-1");
    let json = serde_json::to_string(&rt).unwrap();
    let de: RouteTarget = serde_json::from_str(&json).unwrap();
    assert_eq!(de, rt);
}

#[test]
fn session_id_validate() {
    assert!(SessionId::new("abc").validate().is_ok());
    assert!(SessionId::new("").validate().is_err());
    assert!(SessionId::new("  ").validate().is_err());
}

#[test]
fn session_id_from_str() {
    let sid: SessionId = "s1".into();
    assert_eq!(sid.0, "s1");
}

#[test]
fn node_id_display() {
    let nid = NodeId::new("router-1");
    assert_eq!(format!("{nid}"), "router-1");
}
