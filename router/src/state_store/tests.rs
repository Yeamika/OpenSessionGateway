//! State store tests.

use super::*;
use std::path::PathBuf;
use tempfile::NamedTempFile;

fn temp_path() -> PathBuf {
    let f = NamedTempFile::new().unwrap();
    // Keep the path but close the file so save can write to it
    let path = f.path().to_path_buf();
    drop(f);
    // Remove the file so save creates it fresh
    let _ = std::fs::remove_file(&path);
    path
}

fn sample_state() -> RouterState {
    RouterState {
        schema_version: 1,
        node_id: "test-router".into(),
        updated_at: "2026-05-27T18:00:00Z".into(),
        route_revision: 5,
        rule_revision: 3,
        permission_revision: 2,
        manual_routes: vec![types::SerializedRouteEntry {
            address: "d1/*/*".into(),
            neighbor: "n1".into(),
            distance: 5,
        }],
        rules: vec![types::SerializedRule {
            id: "r1".into(),
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
            action: "drop:evil".into(),
        }],
        persistent_grants: vec![],
        audit_log: vec![],
    }
}

// ── Load / Save round-trip ──

#[test]
fn save_and_load_roundtrip() {
    let path = temp_path();
    let store = StateStore::new(Some(path.clone()));

    let state = sample_state();
    store.save(&state).unwrap();

    let loaded = store.load();
    assert_eq!(loaded.node_id, "test-router");
    assert_eq!(loaded.manual_routes.len(), 1);
    assert_eq!(loaded.rules.len(), 1);
    assert_eq!(loaded.rules[0].id, "r1");
    assert_eq!(loaded.route_revision, 5);
}

#[test]
fn load_missing_file_returns_default() {
    let path = PathBuf::from("/tmp/nonexistent-glassvein-state-12345.json");
    let store = StateStore::new(Some(path));
    let state = store.load();
    assert_eq!(state.node_id, "");
    assert!(state.manual_routes.is_empty());
}

#[test]
fn load_corrupted_file_returns_default() {
    let path = temp_path();
    std::fs::write(&path, "not valid json!!!").unwrap();
    let store = StateStore::new(Some(path));
    let state = store.load();
    assert_eq!(state.node_id, "");
}

#[test]
fn no_path_disables_persistence() {
    let store = StateStore::new(None);
    let state = sample_state();
    store.save(&state).unwrap(); // no-op, should not error
    let loaded = store.load(); // returns default
    assert_eq!(loaded.node_id, "");
}

// ── Atomic write ──

#[test]
fn save_creates_file_atomically() {
    let path = temp_path();
    let store = StateStore::new(Some(path.clone()));

    let state = sample_state();
    store.save(&state).unwrap();

    assert!(path.exists());
    // Temp file should be gone
    let tmp = path.with_extension("json.tmp");
    assert!(!tmp.exists());
}

// ── Path accessor ──

#[test]
fn path_accessor() {
    let path = PathBuf::from("/tmp/test.json");
    let store = StateStore::new(Some(path.clone()));
    assert_eq!(store.path(), Some(path.as_path()));

    let store = StateStore::new(None);
    assert!(store.path().is_none());
}

// ── Serde round-trip ──

#[test]
fn router_state_serde_roundtrip() {
    let state = sample_state();
    let json = serde_json::to_string(&state).unwrap();
    let de: RouterState = serde_json::from_str(&json).unwrap();
    assert_eq!(de.schema_version, 1);
    assert_eq!(de.node_id, "test-router");
}

#[test]
fn router_state_default_has_correct_schema_version() {
    let state = RouterState::default();
    assert_eq!(state.schema_version, 1);
}

// ── Rules round-trip with various fields ──

#[test]
fn rules_roundtrip_with_all_matcher_fields() {
    let path = temp_path();
    let store = StateStore::new(Some(path));

    let state = RouterState {
        schema_version: 1,
        node_id: "rules-test".into(),
        updated_at: "2026-05-27T18:00:00Z".into(),
        route_revision: 0,
        rule_revision: 7,
        permission_revision: 0,
        manual_routes: vec![],
        rules: vec![
            types::SerializedRule {
                id: "drop-evil".into(),
                priority: 10,
                enabled: true,
                source_address: Some("evil/*/*".into()),
                target_address: Some("good/rt1/*".into()),
                link_type: Some("upload".into()),
                subtype: Some("session_update".into()),
                kind: None,
                from_neighbor: Some("n1".into()),
                ttl_min: Some(5),
                ttl_max: Some(30),
                action: "drop:spam".into(),
            },
            types::SerializedRule {
                id: "force-route".into(),
                priority: 20,
                enabled: false,
                source_address: None,
                target_address: None,
                link_type: None,
                subtype: None,
                kind: None,
                from_neighbor: None,
                ttl_min: None,
                ttl_max: None,
                action: "force:n2".into(),
            },
        ],
        persistent_grants: vec![],
        audit_log: vec![],
    };

    store.save(&state).unwrap();
    let loaded = store.load();

    assert_eq!(loaded.rules.len(), 2);
    assert_eq!(loaded.rules[0].id, "drop-evil");
    assert_eq!(loaded.rules[0].source_address.as_deref(), Some("evil/*/*"));
    assert_eq!(loaded.rules[0].target_address.as_deref(), Some("good/rt1/*"));
    assert_eq!(loaded.rules[0].link_type.as_deref(), Some("upload"));
    assert_eq!(loaded.rules[0].subtype.as_deref(), Some("session_update"));
    assert_eq!(loaded.rules[0].from_neighbor.as_deref(), Some("n1"));
    assert_eq!(loaded.rules[0].ttl_min, Some(5));
    assert_eq!(loaded.rules[0].ttl_max, Some(30));
    assert_eq!(loaded.rules[0].action, "drop:spam");

    assert_eq!(loaded.rules[1].id, "force-route");
    assert!(!loaded.rules[1].enabled);
    assert_eq!(loaded.rules[1].action, "force:n2");

    assert_eq!(loaded.rule_revision, 7);
}

#[test]
fn empty_rules_list_survives_roundtrip() {
    let path = temp_path();
    let store = StateStore::new(Some(path));

    let state = RouterState {
        rules: vec![],
        ..sample_state()
    };

    store.save(&state).unwrap();
    let loaded = store.load();
    assert!(loaded.rules.is_empty());
}

// ── Multiple routes round-trip ──

#[test]
fn multiple_manual_routes_roundtrip() {
    let path = temp_path();
    let store = StateStore::new(Some(path));

    let state = RouterState {
        manual_routes: vec![
            types::SerializedRouteEntry {
                address: "d1/*/*".into(),
                neighbor: "n1".into(),
                distance: 5,
            },
            types::SerializedRouteEntry {
                address: "d2/rt1/*".into(),
                neighbor: "n2".into(),
                distance: 10,
            },
            types::SerializedRouteEntry {
                address: "d3/rt2/ses1".into(),
                neighbor: "n1".into(),
                distance: 3,
            },
        ],
        ..sample_state()
    };

    store.save(&state).unwrap();
    let loaded = store.load();

    assert_eq!(loaded.manual_routes.len(), 3);
    assert_eq!(loaded.manual_routes[0].address, "d1/*/*");
    assert_eq!(loaded.manual_routes[1].neighbor, "n2");
    assert_eq!(loaded.manual_routes[2].distance, 3);
}
