//! Route table tests.

use super::*;
use osgp::SessionEnvelope;
use serde_json::json;

fn domain_addr(domain: &str) -> SessionAddress {
    SessionAddress::new(domain, None, None)
}

fn runtime_addr(domain: &str, runtime: &str) -> SessionAddress {
    SessionAddress::new(domain, Some(runtime.into()), None)
}

fn session_addr(domain: &str, runtime: &str, session: &str) -> SessionAddress {
    SessionAddress::new(domain, Some(runtime.into()), Some(session.into()))
}

fn announce(table: &mut RouteTable, addr: &SessionAddress, distance: u32, neighbor: &str) {
    let ann = RouteAnnouncement {
        address: addr.clone(),
        distance,
    };
    table.upsert_announcement(&ann, neighbor);
}

// ── Simple upsert (backward compat) ──

#[test]
fn simple_upsert_inserts_and_decides() {
    let mut table = RouteTable::default();
    let addr = domain_addr("d1");
    table.upsert(addr.clone(), "n1", 2);

    let env = SessionEnvelope::new(domain_addr("src"), addr, "test", json!({}));
    let decision = table.decide(&env);
    assert_eq!(decision.next_hop, NextHop::Neighbor("n1".into()));
}

#[test]
fn simple_upsert_keeps_lower_distance() {
    let mut table = RouteTable::default();
    let addr = domain_addr("d1");
    table.upsert(addr.clone(), "n1", 5);
    table.upsert(addr.clone(), "n2", 2);

    let env = SessionEnvelope::new(domain_addr("src"), addr, "test", json!({}));
    let decision = table.decide(&env);
    // n2 should win with lower distance
    assert_eq!(decision.next_hop, NextHop::Neighbor("n2".into()));
}

// ── Multi-path + shortest distance ──

#[test]
fn resolve_picks_shortest_distance() {
    let mut table = RouteTable::default();
    let addr = domain_addr("d1");
    announce(&mut table, &addr, 3, "n1");
    announce(&mut table, &addr, 1, "n2");

    let decision = table.decide_for_target(&addr, None);
    match decision.next_hop {
        NextHop::Neighbor(id) => assert_eq!(id, "n2"),
        other => panic!("expected Neighbor, got: {:?}", other),
    }
}

// ── Runtime/domain fallback ──

#[test]
fn resolve_falls_back_to_runtime() {
    let mut table = RouteTable::default();
    let sess = session_addr("d1", "r1", "s1");
    let rt = runtime_addr("d1", "r1");
    announce(&mut table, &rt, 0, "n1");

    let decision = table.decide_for_target(&sess, None);
    assert_eq!(decision.next_hop, NextHop::Neighbor("n1".into()));
}

#[test]
fn resolve_falls_back_to_domain() {
    let mut table = RouteTable::default();
    let sess = session_addr("d1", "r1", "s1");
    let dom = domain_addr("d1");
    announce(&mut table, &dom, 0, "n1");

    let decision = table.decide_for_target(&sess, None);
    assert_eq!(decision.next_hop, NextHop::Neighbor("n1".into()));
}

#[test]
fn resolve_prefers_session_over_runtime_over_domain() {
    let mut table = RouteTable::default();
    let sess = session_addr("d1", "r1", "s1");
    let rt = runtime_addr("d1", "r1");
    let dom = domain_addr("d1");

    announce(&mut table, &sess, 10, "n_session");
    announce(&mut table, &rt, 5, "n_runtime");
    announce(&mut table, &dom, 1, "n_domain");

    let decision = table.decide_for_target(&sess, None);
    assert_eq!(decision.next_hop, NextHop::Neighbor("n_session".into()));
}

#[test]
fn resolve_no_route_returns_drop() {
    let table = RouteTable::default();
    let addr = domain_addr("nonexistent");
    let decision = table.decide_for_target(&addr, None);
    assert!(matches!(decision.next_hop, NextHop::Drop(_)));
}

// ── Split horizon ──

#[test]
fn split_horizon_avoids_neighbor() {
    let mut table = RouteTable::default();
    let addr = domain_addr("d1");
    announce(&mut table, &addr, 0, "n1");
    announce(&mut table, &addr, 2, "n2");

    // Avoid n1 → should get n2
    let decision = table.decide_for_target(&addr, Some("n1"));
    match decision.next_hop {
        NextHop::Neighbor(id) => assert_eq!(id, "n2"),
        other => panic!("expected n2, got: {:?}", other),
    }
}

#[test]
fn export_excluding_neighbor() {
    let mut table = RouteTable::default();
    let addr = domain_addr("d1");
    announce(&mut table, &addr, 0, "n1");
    announce(&mut table, &addr, 2, "n2");

    let exported = table.export_announcements_excluding(Some("n1"));
    assert_eq!(exported.len(), 1);
    assert_eq!(exported[0].distance, 3); // 2 + 1
}

// ── Remove neighbor (learned only) ──

#[test]
fn remove_neighbor_cleans_up() {
    let mut table = RouteTable::default();
    let d1 = domain_addr("d1");
    let d2 = domain_addr("d2");
    announce(&mut table, &d1, 0, "n1");
    announce(&mut table, &d2, 0, "n1");
    announce(&mut table, &d1, 2, "n2");

    let changed = table.remove_neighbor("n1");
    assert!(changed);

    // d1 still reachable via n2
    let decision = table.decide_for_target(&d1, None);
    assert_eq!(decision.next_hop, NextHop::Neighbor("n2".into()));

    // d2 gone
    let decision = table.decide_for_target(&d2, None);
    assert!(matches!(decision.next_hop, NextHop::Drop(_)));
}

#[test]
fn remove_neighbor_preserves_manual_routes() {
    let mut table = RouteTable::default();
    let d1 = domain_addr("d1");
    announce(&mut table, &d1, 0, "n1");
    table.insert_manual(d1.clone(), "n1", 5);

    // Both learned + manual exist for n1
    assert_eq!(table.list_all().len(), 2);

    table.remove_neighbor("n1");

    // Manual route survives
    let remaining = table.list_all();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].origin, RouteOrigin::Manual);

    // Still resolvable via manual route
    let decision = table.decide_for_target(&d1, None);
    assert_eq!(decision.next_hop, NextHop::Neighbor("n1".into()));
}

// ── Auto runtime fallback on session announcement ──

#[test]
fn session_announcement_creates_runtime_fallback() {
    let mut table = RouteTable::default();
    let sess = session_addr("d1", "r1", "s1");
    announce(&mut table, &sess, 0, "n1");

    // Session-level should resolve
    let decision = table.decide_for_target(&sess, None);
    assert_eq!(decision.next_hop, NextHop::Neighbor("n1".into()));

    // Runtime-level should also resolve (auto-created)
    let rt = runtime_addr("d1", "r1");
    let decision = table.decide_for_target(&rt, None);
    assert_eq!(decision.next_hop, NextHop::Neighbor("n1".into()));
}

// ── Snapshot ──

#[test]
fn snapshot_returns_sorted_entries() {
    let mut table = RouteTable::default();
    announce(&mut table, &domain_addr("d2"), 0, "n1");
    announce(&mut table, &domain_addr("d1"), 0, "n2");

    let snap = table.snapshot();
    assert_eq!(snap.len(), 2);
    // Sorted by key: d1/*/* < d2/*/*
    assert!(snap[0].0.contains("d1"));
    assert!(snap[1].0.contains("d2"));
}

// ── Origin: learned routes tagged correctly ──

#[test]
fn upsert_announcement_marks_learned() {
    let mut table = RouteTable::default();
    let d1 = domain_addr("d1");
    announce(&mut table, &d1, 0, "n1");

    let entries = table.list_all();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].origin, RouteOrigin::Learned);
}

#[test]
fn upsert_simple_marks_learned() {
    let mut table = RouteTable::default();
    let d1 = domain_addr("d1");
    table.upsert(d1, "n1", 0);

    let entries = table.list_all();
    assert_eq!(entries[0].origin, RouteOrigin::Learned);
}

// ── Manual route management ──

#[test]
fn insert_manual_creates_manual_route() {
    let mut table = RouteTable::default();
    let d1 = domain_addr("d1");
    let changed = table.insert_manual(d1.clone(), "n1", 5);
    assert!(changed);

    let entries = table.list_all();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].origin, RouteOrigin::Manual);
    assert_eq!(entries[0].neighbor, "n1");
    assert_eq!(entries[0].distance, 5);
}

#[test]
fn insert_manual_duplicate_same_neighbor_same_origin_no_change() {
    let mut table = RouteTable::default();
    let d1 = domain_addr("d1");
    assert!(table.insert_manual(d1.clone(), "n1", 5));
    assert!(!table.insert_manual(d1.clone(), "n1", 5));
}

#[test]
fn insert_manual_and_learned_coexist() {
    let mut table = RouteTable::default();
    let d1 = domain_addr("d1");
    table.insert_manual(d1.clone(), "n1", 5);
    announce(&mut table, &d1, 0, "n1");

    // Both entries exist
    let entries = table.list_all();
    assert_eq!(entries.len(), 2);
    assert!(entries.iter().any(|e| e.origin == RouteOrigin::Manual));
    assert!(entries.iter().any(|e| e.origin == RouteOrigin::Learned));
}

#[test]
fn remove_manual_specific_entry() {
    let mut table = RouteTable::default();
    let d1 = domain_addr("d1");
    table.insert_manual(d1.clone(), "n1", 5);
    announce(&mut table, &d1, 0, "n1");

    let removed = table.remove_manual(&d1, "n1");
    assert!(removed);

    // Only learned remains
    let entries = table.list_all();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].origin, RouteOrigin::Learned);
}

#[test]
fn remove_manual_nonexistent_returns_false() {
    let mut table = RouteTable::default();
    let d1 = domain_addr("d1");
    assert!(!table.remove_manual(&d1, "nobody"));
}

// ── Semantic list ──

#[test]
fn list_all_returns_sorted() {
    let mut table = RouteTable::default();
    let d2 = domain_addr("d2");
    let d1 = domain_addr("d1");
    announce(&mut table, &d2, 0, "n1");
    announce(&mut table, &d1, 0, "n2");

    let entries = table.list_all();
    assert_eq!(entries.len(), 2);
    // Sorted by address key then neighbor
    assert_eq!(entries[0].address, d1);
    assert_eq!(entries[1].address, d2);
}

#[test]
fn list_by_neighbor_filters() {
    let mut table = RouteTable::default();
    let d1 = domain_addr("d1");
    let d2 = domain_addr("d2");
    announce(&mut table, &d1, 0, "n1");
    announce(&mut table, &d2, 0, "n2");
    announce(&mut table, &d1, 0, "n2");

    let n1_routes = table.list_by_neighbor("n1");
    assert_eq!(n1_routes.len(), 1);
    assert_eq!(n1_routes[0].neighbor, "n1");

    let n2_routes = table.list_by_neighbor("n2");
    assert_eq!(n2_routes.len(), 2);
}

#[test]
fn list_manual_filters() {
    let mut table = RouteTable::default();
    let d1 = domain_addr("d1");
    let d2 = domain_addr("d2");
    table.insert_manual(d1.clone(), "n1", 5);
    announce(&mut table, &d2, 0, "n2");

    let manual = table.list_manual();
    assert_eq!(manual.len(), 1);
    assert_eq!(manual[0].origin, RouteOrigin::Manual);
    assert_eq!(manual[0].address, d1);
}

// ── Revision ──

#[test]
fn revision_starts_at_zero() {
    let table = RouteTable::default();
    assert_eq!(table.revision(), 0);
}

#[test]
fn revision_bumps_on_upsert() {
    let mut table = RouteTable::default();
    table.upsert(domain_addr("d1"), "n1", 0);
    assert_eq!(table.revision(), 1);
}

#[test]
fn revision_bumps_on_announcement_change() {
    let mut table = RouteTable::default();
    let d1 = domain_addr("d1");
    announce(&mut table, &d1, 0, "n1");
    assert_eq!(table.revision(), 1);

    // Same announcement, no change → revision stays
    announce(&mut table, &d1, 0, "n1");
    assert_eq!(table.revision(), 1);

    // Different distance → change → bump
    announce(&mut table, &d1, 5, "n1");
    assert_eq!(table.revision(), 2);
}

#[test]
fn revision_bumps_on_manual_insert_and_remove() {
    let mut table = RouteTable::default();
    let d1 = domain_addr("d1");
    table.insert_manual(d1.clone(), "n1", 5);
    assert_eq!(table.revision(), 1);

    table.remove_manual(&d1, "n1");
    assert_eq!(table.revision(), 2);
}

#[test]
fn revision_bumps_on_remove_neighbor() {
    let mut table = RouteTable::default();
    announce(&mut table, &domain_addr("d1"), 0, "n1");
    let rev_after_insert = table.revision();

    table.remove_neighbor("n1");
    assert!(table.revision() > rev_after_insert);
}
