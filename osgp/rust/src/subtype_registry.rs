//! Canonical subtype registry for OSGP business messages.
//!
//! This module defines the single source of truth for allowed `(link_type, subtype)`
//! pairs in the GlassVein protocol. Router and endpoint code should use this
//! registry to validate incoming/outgoing business messages.
//!
//! ## Design
//!
//! - Each `LinkType` has a fixed set of allowed subtypes.
//! - `admin.request` / `admin.response` are router-internal exceptions and are
//!   NOT part of this registry; they bypass subtype validation at the router layer.
//! - Response subtypes mirror request/control subtypes; no new subtypes are defined
//!   for responses.
//!
//! ## Wire format
//!
//! Subtypes are `snake_case` strings. The registry is static and known at compile time.

use crate::link_type::LinkType;
use crate::validation::ValidationError;

// ── Canonical subtype lists ──────────────────────────────────────────

/// Upload subtypes (business state pushed from endpoint to viewers).
const UPLOAD_SUBTYPES: &[&str] = &[
    "session_update",
    "requestion_asked",
    "requestion_updated",
    "requestion_resolved",
    "requestion_cancelled",
];

/// Control subtypes (commands from endpoint to runtime).
const CONTROL_SUBTYPES: &[&str] = &[
    "add_prompt",
    "abort_session",
    "compact_session",
    "create_session",
    "rename_session",
    "resume_session",
    "requestion_respond",
];

/// Request subtypes (queries from endpoint to runtime).
const REQUEST_SUBTYPES: &[&str] = &[
    "runtime_workspace_view_snapshot",
    "runtime_requestion_snapshot",
    "runtime_session_view_snapshot",
    "runtime_session_messages",
];

/// Response subtypes mirror request + control subtypes.
/// No new subtypes are defined for responses.
fn response_subtypes() -> Vec<&'static str> {
    let mut v = Vec::new();
    v.extend_from_slice(REQUEST_SUBTYPES);
    v.extend_from_slice(CONTROL_SUBTYPES);
    v
}

// ── Public API ───────────────────────────────────────────────────────

/// Check whether a `(link_type, subtype)` pair is in the canonical registry.
///
/// Returns `true` if the pair is allowed for business messages.
pub fn is_canonical(link_type: &str, subtype: &str) -> bool {
    canonical_subtypes_for(link_type).contains(&subtype)
}

/// Validate that a `(link_type, subtype)` pair is canonical.
///
/// Returns `Ok(())` if valid, or `Err(ValidationError)` if the subtype is
/// not in the registry for the given link type.
pub fn validate_canonical(link_type: &str, subtype: &str) -> Result<(), ValidationError> {
    if is_canonical(link_type, subtype) {
        Ok(())
    } else {
        Err(ValidationError::UnknownSubtype {
            link_type: link_type.to_string(),
            subtype: subtype.to_string(),
        })
    }
}

/// Return the list of canonical subtypes for a given link type string.
///
/// For `"response"`, returns the union of request + control subtypes.
/// For unknown link types, returns an empty slice.
pub fn canonical_subtypes_for(link_type: &str) -> Vec<&'static str> {
    match link_type {
        "upload" => UPLOAD_SUBTYPES.to_vec(),
        "control" => CONTROL_SUBTYPES.to_vec(),
        "request" => REQUEST_SUBTYPES.to_vec(),
        "response" => response_subtypes(),
        _ => Vec::new(),
    }
}

/// Return the canonical subtypes for a typed `LinkType` enum variant.
pub fn canonical_subtypes_for_link_type(link_type: &LinkType) -> Vec<&'static str> {
    match link_type {
        LinkType::Upload => UPLOAD_SUBTYPES.to_vec(),
        LinkType::Control => CONTROL_SUBTYPES.to_vec(),
        LinkType::Request => REQUEST_SUBTYPES.to_vec(),
        LinkType::Response => response_subtypes(),
    }
}

/// Check whether a subtype string is a known request subtype.
pub fn is_request_subtype(subtype: &str) -> bool {
    REQUEST_SUBTYPES.contains(&subtype)
}

/// Check whether a subtype string is a known control subtype.
pub fn is_control_subtype(subtype: &str) -> bool {
    CONTROL_SUBTYPES.contains(&subtype)
}

/// Check whether a subtype string is a known upload subtype.
pub fn is_upload_subtype(subtype: &str) -> bool {
    UPLOAD_SUBTYPES.contains(&subtype)
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Upload subtypes ─────────────────────────────────────────────

    #[test]
    fn upload_session_update_is_canonical() {
        assert!(is_canonical("upload", "session_update"));
    }

    #[test]
    fn upload_requestion_asked_is_canonical() {
        assert!(is_canonical("upload", "requestion_asked"));
    }

    #[test]
    fn upload_requestion_updated_is_canonical() {
        assert!(is_canonical("upload", "requestion_updated"));
    }

    #[test]
    fn upload_requestion_resolved_is_canonical() {
        assert!(is_canonical("upload", "requestion_resolved"));
    }

    #[test]
    fn upload_requestion_cancelled_is_canonical() {
        assert!(is_canonical("upload", "requestion_cancelled"));
    }

    #[test]
    fn upload_unknown_subtype_rejected() {
        assert!(!is_canonical("upload", "unknown_upload"));
    }

    // ── Control subtypes ────────────────────────────────────────────

    #[test]
    fn control_add_prompt_is_canonical() {
        assert!(is_canonical("control", "add_prompt"));
    }

    #[test]
    fn control_abort_session_is_canonical() {
        assert!(is_canonical("control", "abort_session"));
    }

    #[test]
    fn control_compact_session_is_canonical() {
        assert!(is_canonical("control", "compact_session"));
    }

    #[test]
    fn control_create_session_is_canonical() {
        assert!(is_canonical("control", "create_session"));
    }

    #[test]
    fn control_rename_session_is_canonical() {
        assert!(is_canonical("control", "rename_session"));
    }

    #[test]
    fn control_resume_session_is_canonical() {
        assert!(is_canonical("control", "resume_session"));
    }

    #[test]
    fn control_requestion_respond_is_canonical() {
        assert!(is_canonical("control", "requestion_respond"));
    }

    #[test]
    fn control_unknown_subtype_rejected() {
        assert!(!is_canonical("control", "unknown_control"));
    }

    // ── Request subtypes ────────────────────────────────────────────

    #[test]
    fn request_runtime_workspace_view_snapshot_is_canonical() {
        assert!(is_canonical("request", "runtime_workspace_view_snapshot"));
    }

    #[test]
    fn request_runtime_requestion_snapshot_is_canonical() {
        assert!(is_canonical("request", "runtime_requestion_snapshot"));
    }

    #[test]
    fn request_runtime_session_view_snapshot_is_canonical() {
        assert!(is_canonical("request", "runtime_session_view_snapshot"));
    }

    #[test]
    fn request_runtime_session_messages_is_canonical() {
        assert!(is_canonical("request", "runtime_session_messages"));
    }

    #[test]
    fn request_unknown_subtype_rejected() {
        assert!(!is_canonical("request", "unknown_request"));
    }

    // ── Response subtypes (mirror request + control) ────────────────

    #[test]
    fn response_mirrors_request_subtypes() {
        for sub in REQUEST_SUBTYPES {
            assert!(
                is_canonical("response", sub),
                "response should accept request subtype '{sub}'"
            );
        }
    }

    #[test]
    fn response_mirrors_control_subtypes() {
        for sub in CONTROL_SUBTYPES {
            assert!(
                is_canonical("response", sub),
                "response should accept control subtype '{sub}'"
            );
        }
    }

    #[test]
    fn response_unknown_subtype_rejected() {
        assert!(!is_canonical("response", "unknown_response"));
    }

    // ── Unknown link type ───────────────────────────────────────────

    #[test]
    fn unknown_link_type_rejects_all() {
        assert!(!is_canonical("unknown", "session_update"));
        assert!(!is_canonical("unknown", "add_prompt"));
    }

    // ── validate_canonical ──────────────────────────────────────────

    #[test]
    fn validate_canonical_ok_for_valid_pair() {
        assert!(validate_canonical("upload", "session_update").is_ok());
        assert!(validate_canonical("control", "add_prompt").is_ok());
        assert!(validate_canonical("request", "runtime_session_messages").is_ok());
        assert!(validate_canonical("response", "add_prompt").is_ok());
    }

    #[test]
    fn validate_canonical_err_for_invalid_pair() {
        let err = validate_canonical("upload", "bad_subtype").unwrap_err();
        match err {
            ValidationError::UnknownSubtype { link_type, subtype } => {
                assert_eq!(link_type, "upload");
                assert_eq!(subtype, "bad_subtype");
            }
            other => panic!("expected UnknownSubtype, got: {other:?}"),
        }
    }

    // ── canonical_subtypes_for ──────────────────────────────────────

    #[test]
    fn canonical_subtypes_for_upload_count() {
        assert_eq!(canonical_subtypes_for("upload").len(), 5);
    }

    #[test]
    fn canonical_subtypes_for_control_count() {
        assert_eq!(canonical_subtypes_for("control").len(), 7);
    }

    #[test]
    fn canonical_subtypes_for_request_count() {
        assert_eq!(canonical_subtypes_for("request").len(), 4);
    }

    #[test]
    fn canonical_subtypes_for_response_is_union() {
        let subs = canonical_subtypes_for("response");
        assert_eq!(subs.len(), 4 + 7); // request + control
    }

    // ── is_request_subtype / is_control_subtype / is_upload_subtype ─

    #[test]
    fn type_classifier_helpers() {
        assert!(is_upload_subtype("session_update"));
        assert!(!is_upload_subtype("add_prompt"));

        assert!(is_control_subtype("add_prompt"));
        assert!(!is_control_subtype("session_update"));

        assert!(is_request_subtype("runtime_session_messages"));
        assert!(!is_request_subtype("session_update"));
    }

    // ── Mailbox reminder scenario ────────────────────────────────────
    //
    // Mailbox endpoint outbound reminders are normal business control frames:
    //   link_type=control, subtype=add_prompt
    // No new subtypes like mailbox.reminder, MailboxReminders, need_replay are allowed.
    // Mailbox local MCP tool names are just local APIs, not OSGP subtypes.

    #[test]
    fn mailbox_reminder_uses_control_add_prompt() {
        // Mailbox reminders must use canonical control/add_prompt
        assert!(is_canonical("control", "add_prompt"));
        assert!(validate_canonical("control", "add_prompt").is_ok());
    }

    #[test]
    fn mailbox_reminder_response_mirror() {
        // Response to mailbox reminder (add_prompt) is accepted as mirror
        assert!(is_canonical("response", "add_prompt"));
        assert!(validate_canonical("response", "add_prompt").is_ok());
    }

    #[test]
    fn mailbox_dynamic_subtypes_rejected() {
        // Dynamic mailbox subtypes must NOT be canonical
        assert!(!is_canonical("control", "mailbox.reminder"));
        assert!(!is_canonical("control", "MailboxReminders"));
        assert!(!is_canonical("control", "need_replay"));
        assert!(!is_canonical("control", "mailbox_notification"));
        assert!(!is_canonical("control", "im_gateway.message"));
    }

    #[test]
    fn mailbox_mcp_tool_names_not_subtypes() {
        // Local MCP tool names (session_bridge_SendMailboxItem, etc.) are NOT OSGP subtypes
        assert!(!is_canonical("control", "session_bridge_SendMailboxItem"));
        assert!(!is_canonical("control", "session_bridge_ListMailboxItems"));
        assert!(!is_canonical("control", "session_bridge_ReadMailboxItem"));
        assert!(!is_canonical("control", "session_bridge_ReplyMailboxItem"));
    }

    #[test]
    fn mailbox_validate_rejects_unknown_dynamic() {
        // Validate that unknown dynamic subtypes are rejected with proper error
        let err = validate_canonical("control", "mailbox.reminder").unwrap_err();
        match err {
            ValidationError::UnknownSubtype { link_type, subtype } => {
                assert_eq!(link_type, "control");
                assert_eq!(subtype, "mailbox.reminder");
            }
            other => panic!("expected UnknownSubtype, got: {other:?}"),
        }
    }

    #[test]
    fn response_add_prompt_is_mirror_not_new_action() {
        // response/add_prompt is a receipt mirror, not a new permission action
        // It should be accepted but only as a mirror of control/add_prompt
        assert!(is_canonical("response", "add_prompt"));
        // Verify it's in the response list because it mirrors control, not because
        // response defines its own subtypes
        let response_subs = canonical_subtypes_for("response");
        assert!(response_subs.contains(&"add_prompt"));
        // Verify control/add_prompt is also canonical (source of truth)
        assert!(is_canonical("control", "add_prompt"));
    }
}
