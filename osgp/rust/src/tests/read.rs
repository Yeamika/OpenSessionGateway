//! Tests for read request/response types.

use crate::*;

fn src_addr() -> SessionAddress {
    SessionAddress::new("src-domain", Some("src-runtime".into()), None::<String>)
}

fn tgt_addr() -> SessionAddress {
    SessionAddress::new("tgt-domain", Some("tgt-runtime".into()), Some("s1".into()))
}

fn responder_addr() -> SessionAddress {
    SessionAddress::new("tgt-domain", Some("tgt-runtime".into()), None::<String>)
}

// ── Canonical ReadRequest ─────────────────────────────────────────────

#[test]
fn read_request_canonical_new() {
    let req = ReadRequest::new(
        src_addr(),
        tgt_addr(),
        ReadOperation::RuntimeWorkspaceViewSnapshot {
            runtime_id: "rt1".into(),
            workspace: None,
        },
    );
    assert_eq!(req.link_type, "request");
    assert_eq!(req.subtype, "runtime_workspace_view_snapshot");
    assert_eq!(req.source.domain, "src-domain");
    assert_eq!(req.target.domain, "tgt-domain");
    assert_eq!(
        req.target
            .session
            .as_ref()
            .map(|s| s.to_string())
            .as_deref(),
        Some("s1")
    );
}

#[test]
fn read_request_validate_checks_source_and_target() {
    let req = ReadRequest::new(
        SessionAddress::domain_only("valid"),
        tgt_addr(),
        ReadOperation::RuntimeWorkspaceViewSnapshot {
            runtime_id: "rt1".into(),
            workspace: None,
        },
    );
    assert!(req.validate().is_ok());

    // Empty source domain should fail
    let bad_req = ReadRequest::new(
        SessionAddress::domain_only(""),
        tgt_addr(),
        ReadOperation::RuntimeWorkspaceViewSnapshot {
            runtime_id: "rt1".into(),
            workspace: None,
        },
    );
    assert!(bad_req.validate().is_err());
}

#[test]
fn read_request_serde_roundtrip() {
    let req = ReadRequest::new(
        src_addr(),
        tgt_addr(),
        ReadOperation::RuntimeSessionMessages {
            runtime_id: "rt1".into(),
            session_id: SessionId::new("s1"),
            anchor_time: Some("2026-01-01T00:00:00Z".into()),
            limit: Some(20),
            regex: None,
        },
    );
    let json = serde_json::to_string(&req).unwrap();
    let de: ReadRequest = serde_json::from_str(&json).unwrap();
    assert_eq!(de.request_id, req.request_id);
    assert_eq!(de.subtype, "runtime_session_messages");
    assert_eq!(de.source.domain, "src-domain");
    assert_eq!(de.target.domain, "tgt-domain");
}

// ── Canonical variant subtype / op_name ───────────────────────────────

#[test]
fn canonical_runtime_workspace_view_snapshot() {
    let op = ReadOperation::RuntimeWorkspaceViewSnapshot {
        runtime_id: "rt1".into(),
        workspace: None,
    };
    assert_eq!(op.subtype(), "runtime_workspace_view_snapshot");
    assert_eq!(op.op_name(), "runtimeWorkspaceViewSnapshot");
}

#[test]
fn canonical_runtime_requestion_snapshot() {
    let op = ReadOperation::RuntimeRequestionSnapshot {
        runtime_id: "rt1".into(),
        session_id: Some(SessionId::new("s1")),
        status: None,
        blocking: false,
    };
    assert_eq!(op.subtype(), "runtime_requestion_snapshot");
    assert_eq!(op.op_name(), "runtimeRequestionSnapshot");
}

#[test]
fn canonical_runtime_session_view_snapshot() {
    let op = ReadOperation::RuntimeSessionViewSnapshot {
        runtime_id: "rt1".into(),
        session_id: SessionId::new("s1"),
        requestion_status: None,
    };
    assert_eq!(op.subtype(), "runtime_session_view_snapshot");
    assert_eq!(op.op_name(), "runtimeSessionViewSnapshot");
}

#[test]
fn canonical_runtime_session_messages() {
    let op = ReadOperation::RuntimeSessionMessages {
        runtime_id: "rt1".into(),
        session_id: SessionId::new("s1"),
        anchor_time: None,
        limit: None,
        regex: None,
    };
    assert_eq!(op.subtype(), "runtime_session_messages");
    assert_eq!(op.op_name(), "runtimeSessionMessages");
}

// ── Compat alias mapping ─────────────────────────────────────────────

#[test]
#[allow(deprecated)]
fn compat_list_workspaces_maps_to_canonical() {
    let op = ReadOperation::ListWorkspaces;
    assert_eq!(op.subtype(), "runtime_workspace_view_snapshot");
}

#[test]
#[allow(deprecated)]
fn compat_list_session_messages_maps_to_canonical() {
    let op = ReadOperation::ListSessionMessages {
        session_id: SessionId::new("s1"),
        anchor_time: None,
        limit: None,
        regex: None,
    };
    assert_eq!(op.subtype(), "runtime_session_messages");
}

#[test]
#[allow(deprecated)]
fn compat_session_update_snapshot_maps_to_canonical() {
    let op = ReadOperation::SessionUpdateSnapshot {
        session_id: SessionId::new("s1"),
    };
    assert_eq!(op.subtype(), "runtime_session_view_snapshot");
}

// ── ReadResponse with source/target ───────────────────────────────────

#[test]
fn response_ok_for_request() {
    let req = ReadRequest::new(
        src_addr(),
        tgt_addr(),
        ReadOperation::RuntimeSessionViewSnapshot {
            runtime_id: "rt1".into(),
            session_id: SessionId::new("s1"),
            requestion_status: None,
        },
    );
    let resp = ReadResponse::ok_for_request(
        &responder_addr(),
        &req,
        serde_json::json!({"state": "running"}),
    );
    assert!(resp.is_ok());
    // Response source = responder, target = request source
    assert_eq!(resp.source.domain, "tgt-domain");
    assert_eq!(resp.target.domain, "src-domain");
    assert_eq!(resp.request_id, req.request_id);
    assert_eq!(resp.subtype, "runtime_session_view_snapshot");
}

#[test]
fn response_error_for_request() {
    let req = ReadRequest::new(
        src_addr(),
        tgt_addr(),
        ReadOperation::RuntimeSessionMessages {
            runtime_id: "rt1".into(),
            session_id: SessionId::new("s1"),
            anchor_time: None,
            limit: None,
            regex: None,
        },
    );
    let resp = ReadResponse::error_for_request(&responder_addr(), &req, "something failed");
    assert!(!resp.is_ok());
    assert!(matches!(resp.status, ResponseStatus::Error));
    assert_eq!(resp.source.domain, "tgt-domain");
    assert_eq!(resp.target.domain, "src-domain");
    assert_eq!(resp.subtype, "runtime_session_messages");
}

#[test]
fn response_not_found_for_request() {
    let req = ReadRequest::new(
        src_addr(),
        tgt_addr(),
        ReadOperation::RuntimeWorkspaceViewSnapshot {
            runtime_id: "rt1".into(),
            workspace: None,
        },
    );
    let resp = ReadResponse::not_found_for_request(&responder_addr(), &req, "missing");
    assert!(!resp.is_ok());
    assert!(matches!(resp.status, ResponseStatus::NotFound));
    assert_eq!(resp.target.domain, "src-domain");
}

#[test]
fn response_permission_denied_for_request() {
    let req = ReadRequest::new(
        src_addr(),
        tgt_addr(),
        ReadOperation::RuntimeRequestionSnapshot {
            runtime_id: "rt1".into(),
            session_id: None,
            status: None,
            blocking: false,
        },
    );
    let resp = ReadResponse::permission_denied_for_request(&responder_addr(), &req, "no access");
    assert!(!resp.is_ok());
    assert!(matches!(resp.status, ResponseStatus::PermissionDenied));
    assert_eq!(resp.target.domain, "src-domain");
}

#[test]
fn response_serde_roundtrip() {
    let req = ReadRequest::new(
        src_addr(),
        tgt_addr(),
        ReadOperation::RuntimeSessionViewSnapshot {
            runtime_id: "rt1".into(),
            session_id: SessionId::new("s1"),
            requestion_status: None,
        },
    );
    let resp = ReadResponse::ok_for_request(
        &responder_addr(),
        &req,
        serde_json::json!({"state": "active"}),
    );
    let json = serde_json::to_string(&resp).unwrap();
    let de: ReadResponse = serde_json::from_str(&json).unwrap();
    assert_eq!(de.request_id, req.request_id);
    assert_eq!(de.source.domain, "tgt-domain");
    assert_eq!(de.target.domain, "src-domain");
}

// ── Canonical op_name table ──────────────────────────────────────────

#[test]
fn canonical_op_names() {
    assert_eq!(
        ReadOperation::RuntimeWorkspaceViewSnapshot {
            runtime_id: "rt1".into(),
            workspace: None,
        }
        .op_name(),
        "runtimeWorkspaceViewSnapshot"
    );
    assert_eq!(
        ReadOperation::RuntimeRequestionSnapshot {
            runtime_id: "rt1".into(),
            session_id: None,
            status: None,
            blocking: false,
        }
        .op_name(),
        "runtimeRequestionSnapshot"
    );
    assert_eq!(
        ReadOperation::RuntimeSessionViewSnapshot {
            runtime_id: "rt1".into(),
            session_id: SessionId::new("s1"),
            requestion_status: None,
        }
        .op_name(),
        "runtimeSessionViewSnapshot"
    );
    assert_eq!(
        ReadOperation::RuntimeSessionMessages {
            runtime_id: "rt1".into(),
            session_id: SessionId::new("s1"),
            anchor_time: None,
            limit: None,
            regex: None,
        }
        .op_name(),
        "runtimeSessionMessages"
    );
}

// ── Validation ───────────────────────────────────────────────────────

#[test]
fn canonical_validate_requires_runtime_id() {
    let op = ReadOperation::RuntimeWorkspaceViewSnapshot {
        runtime_id: "".into(),
        workspace: None,
    };
    assert!(op.validate().is_err());

    let op2 = ReadOperation::RuntimeWorkspaceViewSnapshot {
        runtime_id: "rt1".into(),
        workspace: None,
    };
    assert!(op2.validate().is_ok());
}
