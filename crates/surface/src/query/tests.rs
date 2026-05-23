use super::*;
use serde_json::json;

fn endpoint_addr() -> SessionAddress {
    SessionAddress::new(
        "query-domain",
        Some("query-rt".into()),
        Some("query-ses".into()),
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
fn query_request_runtime_session_view_snapshot() {
    let qs = QuerySurface::new("qs-1", endpoint_addr());
    let req = qs.build_runtime_session_view_snapshot_request(
        target_addr(),
        "runtime-1",
        "session-1",
        Some("pending".into()),
    );

    assert_eq!(req.source.domain, "query-domain");
    assert!(!req.request_id.is_empty());
    assert_eq!(req.target.domain, "target-domain");
    assert_eq!(req.subtype, "runtime_session_view_snapshot");

    match &req.operation {
        ReadOperation::RuntimeSessionViewSnapshot {
            runtime_id,
            session_id,
            requestion_status,
        } => {
            assert_eq!(runtime_id, "runtime-1");
            assert_eq!(session_id.0, "session-1");
            assert_eq!(requestion_status.as_deref(), Some("pending"));
        }
        other => panic!("expected RuntimeSessionViewSnapshot, got: {:?}", other),
    }
}

#[test]
fn query_request_runtime_workspace_view_tree() {
    let qs = QuerySurface::new("qs-1", endpoint_addr());
    let req = qs.build_runtime_workspace_view_snapshot_request(target_addr(), "runtime-1", None);

    assert_eq!(req.subtype, "runtime_workspace_view_snapshot");
    match &req.operation {
        ReadOperation::RuntimeWorkspaceViewSnapshot {
            runtime_id,
            workspace,
        } => {
            assert_eq!(runtime_id, "runtime-1");
            assert_eq!(workspace, &None);
        }
        other => panic!("expected RuntimeWorkspaceViewSnapshot, got: {:?}", other),
    }
}

#[test]
fn query_request_runtime_workspace_view_detail() {
    let qs = QuerySurface::new("qs-1", endpoint_addr());
    let req = qs.build_runtime_workspace_view_snapshot_request(
        target_addr(),
        "runtime-1",
        Some("ws-1".into()),
    );

    assert_eq!(req.subtype, "runtime_workspace_view_snapshot");
    match &req.operation {
        ReadOperation::RuntimeWorkspaceViewSnapshot {
            runtime_id,
            workspace,
        } => {
            assert_eq!(runtime_id, "runtime-1");
            assert_eq!(workspace.as_deref(), Some("ws-1"));
        }
        other => panic!("expected RuntimeWorkspaceViewSnapshot, got: {:?}", other),
    }
}

#[test]
fn query_request_runtime_session_messages() {
    let qs = QuerySurface::new("qs-1", endpoint_addr());
    let req = qs.build_runtime_session_messages_request(
        target_addr(),
        "runtime-1",
        "session-1",
        Some(50),
    );

    assert_eq!(req.subtype, "runtime_session_messages");
    match &req.operation {
        ReadOperation::RuntimeSessionMessages {
            runtime_id,
            session_id,
            limit,
            ..
        } => {
            assert_eq!(runtime_id, "runtime-1");
            assert_eq!(session_id.0, "session-1");
            assert_eq!(*limit, Some(50));
        }
        other => panic!("expected RuntimeSessionMessages, got: {:?}", other),
    }
}

#[test]
fn query_request_runtime_requestion_snapshot() {
    let qs = QuerySurface::new("qs-1", endpoint_addr());
    let req = qs.build_runtime_requestion_snapshot_request(
        target_addr(),
        "runtime-1",
        Some("session-1".into()),
        Some("pending".into()),
        false,
    );

    assert_eq!(req.subtype, "runtime_requestion_snapshot");
    match &req.operation {
        ReadOperation::RuntimeRequestionSnapshot {
            runtime_id,
            session_id,
            status,
            blocking,
        } => {
            assert_eq!(runtime_id, "runtime-1");
            assert_eq!(session_id.as_ref().unwrap().0, "session-1");
            assert_eq!(status.as_deref(), Some("pending"));
            assert!(!blocking);
        }
        other => panic!("expected RuntimeRequestionSnapshot, got: {:?}", other),
    }
}

#[test]
fn query_request_source_address_preserved() {
    let qs = QuerySurface::new("qs-1", endpoint_addr());
    let req = qs.build_runtime_session_view_snapshot_request(
        target_addr(),
        "runtime-1",
        "session-1",
        None,
    );

    assert_eq!(req.source.domain, "query-domain");
    assert_eq!(req.source.runtime.as_deref(), Some("query-rt"));

    let json = serde_json::to_string(&req).unwrap();
    let de: ReadRequest = serde_json::from_str(&json).unwrap();
    assert_eq!(de.source.domain, "query-domain");
}

#[test]
fn query_response_parse() {
    let qs = QuerySurface::new("qs-1", endpoint_addr());
    let req = qs.build_runtime_requestion_snapshot_request(
        target_addr(),
        "runtime-1",
        Some("session-1".into()),
        None,
        false,
    );
    let resp = ReadResponse::ok_for_request(&target_addr(), &req, json!({"state": "running"}));

    assert_eq!(resp.request_id, req.request_id);
    assert!(resp.is_ok());
}

#[test]
fn query_response_permission_denied() {
    let qs = QuerySurface::new("qs-1", endpoint_addr());
    let req = qs.build_runtime_requestion_snapshot_request(
        target_addr(),
        "runtime-1",
        Some("session-1".into()),
        None,
        false,
    );
    let resp = ReadResponse::permission_denied_for_request(&target_addr(), &req, "not authorized");

    assert_eq!(resp.request_id, req.request_id);
    assert!(!resp.is_ok());
    assert_eq!(resp.status, ResponseStatus::PermissionDenied);
    assert_eq!(resp.payload["reason"], "not authorized");
}

#[test]
fn query_response_not_found() {
    let qs = QuerySurface::new("qs-1", endpoint_addr());
    let req = qs.build_runtime_requestion_snapshot_request(
        target_addr(),
        "runtime-1",
        Some("session-1".into()),
        None,
        false,
    );
    let resp = ReadResponse::not_found_for_request(&target_addr(), &req, "session not found");

    assert_eq!(resp.request_id, req.request_id);
    assert!(!resp.is_ok());
    assert_eq!(resp.status, ResponseStatus::NotFound);
    assert_eq!(resp.payload["reason"], "session not found");
}

#[test]
fn read_operation_op_name() {
    let ops = vec![
        (
            ReadOperation::RuntimeSessionMessages {
                runtime_id: "rt1".into(),
                session_id: "s1".into(),
                anchor_time: None,
                limit: None,
                regex: None,
            },
            "runtimeSessionMessages",
        ),
        (
            ReadOperation::RuntimeWorkspaceViewSnapshot {
                runtime_id: "rt1".into(),
                workspace: None,
            },
            "runtimeWorkspaceViewSnapshot",
        ),
        (
            ReadOperation::RuntimeRequestionSnapshot {
                runtime_id: "rt1".into(),
                session_id: Some("s1".into()),
                status: None,
                blocking: false,
            },
            "runtimeRequestionSnapshot",
        ),
        (
            ReadOperation::RuntimeSessionViewSnapshot {
                runtime_id: "rt1".into(),
                session_id: "s1".into(),
                requestion_status: None,
            },
            "runtimeSessionViewSnapshot",
        ),
    ];

    for (op, expected_name) in ops {
        assert_eq!(op.op_name(), expected_name);
    }
}

#[test]
fn read_request_validate() {
    let qs = QuerySurface::new("qs-1", endpoint_addr());
    let req = qs.build_runtime_requestion_snapshot_request(
        target_addr(),
        "runtime-1",
        Some("session-1".into()),
        None,
        false,
    );
    assert!(req.validate().is_ok());
}

#[test]
fn link_message_read_request_roundtrip() {
    let qs = QuerySurface::new("qs-1", endpoint_addr());
    let req = qs.build_runtime_requestion_snapshot_request(
        target_addr(),
        "runtime-1",
        Some("session-1".into()),
        None,
        false,
    );
    let msg = osgp::LinkMessage::ReadRequest(req);

    let json = serde_json::to_string(&msg).unwrap();
    let de: osgp::LinkMessage = serde_json::from_str(&json).unwrap();
    let json2 = serde_json::to_string(&de).unwrap();
    assert_eq!(json, json2, "serde round-trip mismatch");
}

#[test]
#[allow(deprecated)]
fn deprecated_wrappers_emit_canonical_subtypes() {
    let qs = QuerySurface::new("qs-1", endpoint_addr());

    assert_eq!(
        qs.build_list_workspaces_request(target_addr()).subtype,
        "runtime_workspace_view_snapshot"
    );
    assert_eq!(
        qs.build_read_workspace_info_request(target_addr(), "ws-1")
            .subtype,
        "runtime_workspace_view_snapshot"
    );
    assert_eq!(
        qs.build_session_message_read_request(target_addr(), "session-1", Some(10))
            .subtype,
        "runtime_session_messages"
    );
    assert_eq!(
        qs.build_session_update_request(target_addr(), "session-1")
            .subtype,
        "runtime_session_view_snapshot"
    );
    assert_eq!(
        qs.build_session_view_snapshot_request(target_addr(), "session-1", None)
            .subtype,
        "runtime_session_view_snapshot"
    );
    assert_eq!(
        qs.build_requestion_snapshot_request(target_addr(), "session-1", Some("pending".into()))
            .subtype,
        "runtime_requestion_snapshot"
    );
}
