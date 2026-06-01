//! Integration tests: shell → admin → state round-trip.

use super::*;

/// Simulate the full lifecycle: shell commands mutate admin state,
/// then capture state for persistence, save/load round-trip.
#[tokio::test]
async fn integration_shell_route_add_state_roundtrip() {
    use crate::state_store::{StateStore, RouterState, SerializedRouteEntry};
    use tempfile::NamedTempFile;

    let exec = make_executor();

    // Use shell to add manual routes
    let out = exec
        .execute(ShellCommand::RouteAdd {
            address: "d1/*/*".into(),
            peer: "n1".into(),
            distance: 5,
        })
        .await;
    assert!(!out.is_error, "route add should succeed: {}", out.text);

    let out = exec
        .execute(ShellCommand::RouteAdd {
            address: "d2/rt1/ses1".into(),
            peer: "n2".into(),
            distance: 3,
        })
        .await;
    assert!(!out.is_error, "route add should succeed: {}", out.text);

    // Capture state from admin handler (same pattern as main.rs shutdown)
    let rt = exec.admin.route_table().read().await;
    let manual = rt.list_manual();
    let state = RouterState {
        schema_version: 1,
        node_id: "test-router".into(),
        updated_at: "0".into(),
        route_revision: rt.revision(),
        rule_revision: 0,
        permission_revision: 0,
        manual_routes: manual
            .iter()
            .map(|e| SerializedRouteEntry {
                address: crate::format_address(&e.address),
                neighbor: e.neighbor.clone(),
                distance: e.distance,
            })
            .collect(),
        rules: Vec::new(),
        persistent_grants: Vec::new(),
        audit_log: Vec::new(),
    };
    drop(rt);

    // Save to temp file
    let f = NamedTempFile::new().unwrap();
    let path = f.path().to_path_buf();
    drop(f);
    let _ = std::fs::remove_file(&path);

    let store = StateStore::new(Some(path));
    store.save(&state).unwrap();

    // Load back
    let loaded = store.load();
    assert_eq!(loaded.manual_routes.len(), 2);
    assert_eq!(loaded.manual_routes[0].address, "d1/*/*");
    assert_eq!(loaded.manual_routes[0].neighbor, "n1");
    assert_eq!(loaded.manual_routes[0].distance, 5);
    assert_eq!(loaded.manual_routes[1].address, "d2/rt1/ses1");
    assert_eq!(loaded.manual_routes[1].neighbor, "n2");
    assert_eq!(loaded.manual_routes[1].distance, 3);
}

/// Simulate rule add via admin handler, then state capture and round-trip.
#[tokio::test]
async fn integration_admin_rule_add_state_roundtrip() {
    use crate::state_store::{StateStore, RouterState, SerializedRule};
    use tempfile::NamedTempFile;

    let exec = make_executor();

    // Add a rule via admin handler (same as shell → executor → admin path)
    let resp = exec
        .admin
        .handle(crate::admin::AdminRequest::RuleAdd {
            rule_def: crate::admin::AdminRuleDef {
                id: "block-evil".into(),
                priority: 10,
                enabled: true,
                source_address: None,
                target_address: None,
                link_type: Some("upload".into()),
                subtype: None,
                kind: None,
                from_neighbor: None,
                ttl_min: None,
                ttl_max: None,
                action: "drop:evil-source".into(),
            },
        })
        .await;
    assert!(resp.ok, "rule add should succeed: {:?}", resp.error);

    // Capture rules from admin handler
    let rule_table = exec.admin.rule_table().read().await;
    let rules: Vec<SerializedRule> = rule_table
        .list_rules()
        .into_iter()
        .map(|r| SerializedRule {
            id: r.id.clone(),
            priority: r.priority,
            enabled: r.enabled,
            source_address: r.matcher.source_address.as_ref().map(|a| crate::format_address(a)),
            target_address: r.matcher.target_address.as_ref().map(|a| crate::format_address(a)),
            link_type: r.matcher.link_type.clone(),
            subtype: r.matcher.subtype.clone(),
            kind: r.matcher.kind.clone(),
            from_neighbor: r.matcher.from_neighbor.clone(),
            ttl_min: r.matcher.ttl_min,
            ttl_max: r.matcher.ttl_max,
            action: format_rule_action(&r.action),
        })
        .collect();
    let revision = rule_table.revision();
    drop(rule_table);

    // Helper to format action (same as main.rs)
    fn format_rule_action(action: &gv_core::RuleAction) -> String {
        match action {
            gv_core::RuleAction::Drop { reason } => format!("drop:{}", reason),
            gv_core::RuleAction::ForceNeighbor { neighbor_id } => format!("force:{}", neighbor_id),
            gv_core::RuleAction::DenyNeighbor { neighbor_id } => format!("deny:{}", neighbor_id),
            gv_core::RuleAction::Continue => "continue".to_string(),
        }
    }

    let state = RouterState {
        schema_version: 1,
        node_id: "test-router".into(),
        updated_at: "0".into(),
        route_revision: 0,
        rule_revision: revision,
        permission_revision: 0,
        manual_routes: Vec::new(),
        rules,
        persistent_grants: Vec::new(),
        audit_log: Vec::new(),
    };

    // Save and load
    let f = NamedTempFile::new().unwrap();
    let path = f.path().to_path_buf();
    drop(f);
    let _ = std::fs::remove_file(&path);

    let store = StateStore::new(Some(path));
    store.save(&state).unwrap();
    let loaded = store.load();

    assert_eq!(loaded.rules.len(), 1);
    assert_eq!(loaded.rules[0].id, "block-evil");
    assert_eq!(loaded.rules[0].link_type.as_deref(), Some("upload"));
    assert_eq!(loaded.rules[0].action, "drop:evil-source");
    assert!(loaded.rules[0].enabled);
    assert_eq!(loaded.rule_revision, revision);
}

/// Simulate permission approve (persist), capture grants, save/load round-trip.
#[tokio::test]
async fn integration_persistent_grants_state_roundtrip() {
    use crate::state_store::{StateStore, RouterState};
    use tempfile::NamedTempFile;

    let exec = make_executor();

    // Enqueue and approve a persistent grant
    let req_id = {
        let mut perms = exec.permissions.write().await;
        perms.enqueue("peer-1".into(), gv_core::PermissionOp::AdminRoutesRead)
    };
    {
        let mut perms = exec.permissions.write().await;
        assert!(perms.approve(&req_id, gv_core::ApprovalKind::Persist));
    }

    // Capture persistent grants
    let perms = exec.permissions.read().await;
    let grants: Vec<_> = perms
        .list_grants()
        .into_iter()
        .filter(|g| matches!(g.kind, gv_core::ApprovalKind::Persist))
        .cloned()
        .collect();
    let perm_rev = perms.revision();
    drop(perms);

    assert_eq!(grants.len(), 1);
    assert_eq!(grants[0].peer_id, "peer-1");

    let state = RouterState {
        schema_version: 1,
        node_id: "test-router".into(),
        updated_at: "0".into(),
        route_revision: 0,
        rule_revision: 0,
        permission_revision: perm_rev,
        manual_routes: Vec::new(),
        rules: Vec::new(),
        persistent_grants: grants,
        audit_log: Vec::new(),
    };

    // Save and load
    let f = NamedTempFile::new().unwrap();
    let path = f.path().to_path_buf();
    drop(f);
    let _ = std::fs::remove_file(&path);

    let store = StateStore::new(Some(path));
    store.save(&state).unwrap();
    let loaded = store.load();

    assert_eq!(loaded.persistent_grants.len(), 1);
    assert_eq!(loaded.persistent_grants[0].peer_id, "peer-1");
    assert_eq!(loaded.permission_revision, perm_rev);
}

/// Combined: routes + rules + grants in one state, save/load round-trip.
#[tokio::test]
async fn integration_combined_state_roundtrip() {
    use crate::state_store::{StateStore, RouterState, SerializedRouteEntry, SerializedRule};
    use tempfile::NamedTempFile;

    let exec = make_executor();

    // Add route via shell
    exec.execute(ShellCommand::RouteAdd {
        address: "app/*/*".into(),
        peer: "edge-1".into(),
        distance: 2,
    })
    .await;

    // Add rule via admin
    exec.admin
        .handle(crate::admin::AdminRequest::RuleAdd {
            rule_def: crate::admin::AdminRuleDef {
                id: "r1".into(),
                priority: 5,
                enabled: true,
                source_address: None,
                target_address: None,
                link_type: None,
                subtype: None,
                kind: None,
                from_neighbor: Some("bad-peer".into()),
                ttl_min: None,
                ttl_max: None,
                action: "deny:bad-peer".into(),
            },
        })
        .await;

    // Add persistent grant
    {
        let mut perms = exec.permissions.write().await;
        let id = perms.enqueue("edge-1".into(), gv_core::PermissionOp::AnnounceRoute);
        perms.approve(&id, gv_core::ApprovalKind::Persist);
    }

    // Capture full state
    let rt = exec.admin.route_table().read().await;
    let rule_table = exec.admin.rule_table().read().await;
    let perms = exec.permissions.read().await;

    fn fmt_action(action: &gv_core::RuleAction) -> String {
        match action {
            gv_core::RuleAction::Drop { reason } => format!("drop:{}", reason),
            gv_core::RuleAction::ForceNeighbor { neighbor_id } => format!("force:{}", neighbor_id),
            gv_core::RuleAction::DenyNeighbor { neighbor_id } => format!("deny:{}", neighbor_id),
            gv_core::RuleAction::Continue => "continue".to_string(),
        }
    }

    let state = RouterState {
        schema_version: 1,
        node_id: "combined-test".into(),
        updated_at: "0".into(),
        route_revision: rt.revision(),
        rule_revision: rule_table.revision(),
        permission_revision: perms.revision(),
        manual_routes: rt
            .list_manual()
            .iter()
            .map(|e| SerializedRouteEntry {
                address: crate::format_address(&e.address),
                neighbor: e.neighbor.clone(),
                distance: e.distance,
            })
            .collect(),
        rules: rule_table
            .list_rules()
            .into_iter()
            .map(|r| SerializedRule {
                id: r.id.clone(),
                priority: r.priority,
                enabled: r.enabled,
                source_address: r.matcher.source_address.as_ref().map(|a| crate::format_address(a)),
                target_address: r.matcher.target_address.as_ref().map(|a| crate::format_address(a)),
                link_type: r.matcher.link_type.clone(),
                subtype: r.matcher.subtype.clone(),
                kind: r.matcher.kind.clone(),
                from_neighbor: r.matcher.from_neighbor.clone(),
                ttl_min: r.matcher.ttl_min,
                ttl_max: r.matcher.ttl_max,
                action: fmt_action(&r.action),
            })
            .collect(),
        persistent_grants: perms
            .list_grants()
            .into_iter()
            .filter(|g| matches!(g.kind, gv_core::ApprovalKind::Persist))
            .cloned()
            .collect(),
        audit_log: Vec::new(),
    };

    drop((rt, rule_table, perms));

    // Save and load
    let f = NamedTempFile::new().unwrap();
    let path = f.path().to_path_buf();
    drop(f);
    let _ = std::fs::remove_file(&path);

    let store = StateStore::new(Some(path));
    store.save(&state).unwrap();
    let loaded = store.load();

    // Verify all three categories survived round-trip
    assert_eq!(loaded.manual_routes.len(), 1);
    assert_eq!(loaded.manual_routes[0].address, "app/*/*");
    assert_eq!(loaded.manual_routes[0].neighbor, "edge-1");

    assert_eq!(loaded.rules.len(), 1);
    assert_eq!(loaded.rules[0].id, "r1");
    assert_eq!(loaded.rules[0].from_neighbor.as_deref(), Some("bad-peer"));
    assert_eq!(loaded.rules[0].action, "deny:bad-peer");

    assert_eq!(loaded.persistent_grants.len(), 1);
    assert_eq!(loaded.persistent_grants[0].peer_id, "edge-1");
}
