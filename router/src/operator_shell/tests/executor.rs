//! Executor tests for operator shell commands.

use super::*;

#[tokio::test]
async fn exec_help() {
    let exec = make_executor();
    let out = exec.execute(ShellCommand::Help).await;
    assert!(!out.is_error);
    assert!(out.text.contains("Available commands"));
}

#[tokio::test]
async fn exec_peers() {
    let exec = make_executor();
    let out = exec.execute(ShellCommand::Peers).await;
    assert!(!out.is_error);
    assert!(out.text.contains("peer-1"));
    assert!(out.text.contains("child-router"));
}

#[tokio::test]
async fn exec_peer_show() {
    let exec = make_executor();
    let out = exec
        .execute(ShellCommand::PeerShow {
            peer_id: "peer-1".into(),
        })
        .await;
    assert!(!out.is_error);
    assert!(out.text.contains("surface_viewer"));
}

#[tokio::test]
async fn exec_peer_show_not_found() {
    let exec = make_executor();
    let out = exec
        .execute(ShellCommand::PeerShow {
            peer_id: "nobody".into(),
        })
        .await;
    assert!(out.is_error);
}

#[tokio::test]
async fn exec_requests_empty() {
    let exec = make_executor();
    let out = exec.execute(ShellCommand::Requests).await;
    assert!(!out.is_error);
    assert!(out.text.contains("No pending"));
}

#[tokio::test]
async fn exec_approve_and_deny() {
    let exec = make_executor();
    // Enqueue a request
    {
        let mut perms = exec.permissions.write().await;
        perms.enqueue("peer-1".into(), gv_core::PermissionOp::AdminRoutesRead);
    }

    // List requests
    let out = exec.execute(ShellCommand::Requests).await;
    assert!(!out.is_error);
    assert!(out.text.contains("req-0"));

    // Approve
    let out = exec
        .execute(ShellCommand::Approve {
            request_id: "req-0".into(),
            kind: "persist".into(),
        })
        .await;
    assert!(!out.is_error);
    assert!(out.text.contains("approved"));

    // Approve again should fail
    let out = exec
        .execute(ShellCommand::Approve {
            request_id: "req-0".into(),
            kind: "once".into(),
        })
        .await;
    assert!(out.is_error);
}

#[tokio::test]
async fn exec_deny() {
    let exec = make_executor();
    {
        let mut perms = exec.permissions.write().await;
        perms.enqueue("peer-1".into(), gv_core::PermissionOp::AdminRoutesRead);
    }

    let out = exec
        .execute(ShellCommand::Deny {
            request_id: "req-0".into(),
        })
        .await;
    assert!(!out.is_error);
    assert!(out.text.contains("denied"));
}

#[tokio::test]
async fn exec_deny_not_found() {
    let exec = make_executor();
    let out = exec
        .execute(ShellCommand::Deny {
            request_id: "nobody".into(),
        })
        .await;
    assert!(out.is_error);
}

#[tokio::test]
async fn exec_routes_empty() {
    let exec = make_executor();
    let out = exec.execute(ShellCommand::Routes).await;
    assert!(!out.is_error);
}

#[tokio::test]
async fn exec_route_add_and_list() {
    let exec = make_executor();
    let out = exec
        .execute(ShellCommand::RouteAdd {
            address: "d1".into(),
            peer: "n1".into(),
            distance: 5,
        })
        .await;
    assert!(!out.is_error);

    let out = exec.execute(ShellCommand::Routes).await;
    assert!(!out.is_error);
    assert!(out.text.contains("d1"));
}

#[tokio::test]
async fn exec_route_remove() {
    let exec = make_executor();
    exec.execute(ShellCommand::RouteAdd {
        address: "d1".into(),
        peer: "n1".into(),
        distance: 5,
    })
    .await;

    let out = exec
        .execute(ShellCommand::RouteRemove {
            address: "d1".into(),
            peer: Some("n1".into()),
        })
        .await;
    assert!(!out.is_error);
}

#[tokio::test]
async fn exec_rules_empty() {
    let exec = make_executor();
    let out = exec.execute(ShellCommand::Rules).await;
    assert!(!out.is_error);
}

#[tokio::test]
async fn exec_rule_enable_disable() {
    let exec = make_executor();
    // Add a rule via admin handler
    exec.admin
        .handle(crate::admin::AdminRequest::RuleAdd {
            rule_def: crate::admin::AdminRuleDef {
                id: "r1".into(),
                priority: 10,
                enabled: true,
                source_address: None,
                target_address: None,
                link_type: None,
                subtype: None,
                kind: None,
                from_neighbor: None,
                ttl_min: None,
                ttl_max: None,
                action: "continue".into(),
            },
        })
        .await;

    // Disable
    let out = exec
        .execute(ShellCommand::RuleDisable {
            rule_id: "r1".into(),
        })
        .await;
    assert!(!out.is_error);

    // Enable
    let out = exec
        .execute(ShellCommand::RuleEnable {
            rule_id: "r1".into(),
        })
        .await;
    assert!(!out.is_error);

    // Remove
    let out = exec
        .execute(ShellCommand::RuleRemove {
            rule_id: "r1".into(),
        })
        .await;
    assert!(!out.is_error);
}

#[tokio::test]
async fn exec_dry_run_with_envelope() {
    let exec = make_executor();
    let env_json = serde_json::json!({
        "id": "00000000-0000-0000-0000-000000000001",
        "source": {"domain": "src", "runtime": null, "session": null},
        "target": {"domain": "tgt", "runtime": "rt1", "session": "s1"},
        "kind": "upload",
        "linkType": "upload",
        "subtype": "session_update",
        "payload": {},
        "ttl": 32,
        "routeHops": [],
        "originSurface": null
    });
    let out = exec
        .execute(ShellCommand::DryRun {
            args: serde_json::to_string(&env_json).unwrap(),
        })
        .await;
    assert!(!out.is_error);
    assert!(out.text.contains("Dry Run"));
    assert!(out.text.contains("Route decision"));
}

#[tokio::test]
async fn exec_dry_run_empty_args() {
    let exec = make_executor();
    let out = exec
        .execute(ShellCommand::DryRun {
            args: String::new(),
        })
        .await;
    assert!(out.is_error);
}

#[tokio::test]
async fn exec_tail_empty() {
    let exec = make_executor();
    let out = exec.execute(ShellCommand::Tail).await;
    assert!(!out.is_error);
    assert!(out.text.contains("No recent"));
}

#[tokio::test]
async fn exec_tail_with_events() {
    let exec = make_executor();
    {
        let mut buf = exec.audit_buffer.write().await;
        buf.push("[12:00:00] peer-1 connected".into());
        buf.push("[12:00:01] route added d1 via n1".into());
    }
    let out = exec.execute(ShellCommand::Tail).await;
    assert!(!out.is_error);
    assert!(out.text.contains("peer-1 connected"));
    assert!(out.text.contains("route added"));
}

#[tokio::test]
async fn exec_quit() {
    let exec = make_executor();
    let out = exec.execute(ShellCommand::Quit).await;
    assert!(!out.is_error);
    assert!(out.text.contains("Bye"));
}

#[tokio::test]
async fn exec_unknown() {
    let exec = make_executor();
    let out = exec
        .execute(ShellCommand::Unknown {
            input: "foobar".into(),
        })
        .await;
    assert!(out.is_error);
    assert!(out.text.contains("Unknown command"));
}
