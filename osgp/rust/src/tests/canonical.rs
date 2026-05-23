//! Tests for canonical type/subtype derivation.

use crate::envelope::canonical_type_subtype;

#[test]
fn canonical_type_subtype_session_update() {
    let (t, s) = canonical_type_subtype("session_update", &serde_json::json!({}));
    assert_eq!(t, "upload");
    assert_eq!(s, "session_update");
}

#[test]
fn canonical_type_subtype_control() {
    let (t, s) = canonical_type_subtype(
        "control.add_prompt",
        &serde_json::json!({"subtype": "add_prompt"}),
    );
    assert_eq!(t, "control");
    assert_eq!(s, "add_prompt");
}

#[test]
fn canonical_type_subtype_requestion() {
    let (t, s) = canonical_type_subtype("requestion.asked", &serde_json::json!({}));
    assert_eq!(t, "upload");
    assert_eq!(s, "requestion_asked");
}

#[test]
fn canonical_type_subtype_passthrough() {
    let (t, s) = canonical_type_subtype("custom_event", &serde_json::json!({}));
    assert_eq!(t, "custom_event");
    assert_eq!(s, "custom_event");
}
