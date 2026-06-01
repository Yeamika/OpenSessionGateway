//! Forward engine tests.

use super::*;
use crate::filter::DomainWhitelistFilter;
use crate::route::RouteAnnouncement;
use crate::rule::{Rule, RuleAction, RuleMatcher, RuleTable};
use crate::transport::{InMemoryTransport, Transport};
use serde_json::json;
use osgp::SessionAddress;
use std::sync::Arc;
use tokio::sync::RwLock;

fn addr(domain: &str) -> SessionAddress {
    SessionAddress::new(domain, Some("rt".into()), Some("ses".into()))
}

fn envelope(src_domain: &str, tgt_domain: &str) -> SessionEnvelope {
    SessionEnvelope::new(
        addr(src_domain),
        addr(tgt_domain),
        "test.ping",
        json!({"msg":"hi"}),
    )
}

#[tokio::test]
async fn process_no_filters_with_route() {
    let engine = ForwardEngine::new_no_filters("r1".into());

    let ann = RouteAnnouncement::local(addr("target"));
    engine
        .route_table()
        .write()
        .await
        .upsert_announcement(&ann, "n1");

    let env = envelope("src", "target");
    let decision = engine.process_envelope(env, None, false).await;

    assert!(decision.blocked_by_filter.is_none());
    match decision.plan {
        ForwardPlan::ForwardNeighbor { neighbor_id } => assert_eq!(neighbor_id, "n1"),
        other => panic!("expected ForwardNeighbor, got: {:?}", other),
    }
}

#[tokio::test]
async fn process_ttl_exhausted() {
    let engine = ForwardEngine::new_no_filters("r1".into());

    let mut env = envelope("src", "target");
    env.ttl = 0;

    let decision = engine.process_envelope(env, None, false).await;

    match decision.plan {
        ForwardPlan::Drop { reason } => assert!(reason.contains("ttl")),
        other => panic!("expected Drop, got: {:?}", other),
    }
}

#[tokio::test]
async fn process_blocked_by_filter() {
    let engine = ForwardEngine::new(
        "r1".into(),
        vec![Box::new(DomainWhitelistFilter::new(vec!["allowed".into()]))],
    );

    let env = envelope("src", "blocked");
    let decision = engine.process_envelope(env, None, false).await;

    assert_eq!(
        decision.blocked_by_filter,
        Some("domain_whitelist".to_string())
    );
}

#[tokio::test]
async fn process_no_route_with_fallback() {
    let engine = ForwardEngine::new_no_filters("r1".into());

    let env = envelope("src", "unknown");
    let decision = engine.process_envelope(env, None, false).await;

    match decision.plan {
        ForwardPlan::NoRoute { fallback_available } => assert!(fallback_available),
        other => panic!("expected NoRoute, got: {:?}", other),
    }
}

#[tokio::test]
async fn process_no_route_from_upstream_no_fallback() {
    let engine = ForwardEngine::new_no_filters("r1".into());

    let env = envelope("src", "unknown");
    let decision = engine.process_envelope(env, Some("upstream-1"), true).await;

    match decision.plan {
        ForwardPlan::Drop { .. } => {}
        ForwardPlan::NoRoute { fallback_available } => assert!(!fallback_available),
        other => panic!(
            "expected Drop or NoRoute without fallback, got: {:?}",
            other
        ),
    }
}

#[tokio::test]
async fn execute_forward_neighbor() {
    let engine = ForwardEngine::new_no_filters("r1".into());

    let ann = RouteAnnouncement::local(addr("target"));
    engine
        .route_table()
        .write()
        .await
        .upsert_announcement(&ann, "n1");

    let env = envelope("src", "target");
    let decision = engine.process_envelope(env, None, false).await;

    let (t_neighbor, t_mirror) = InMemoryTransport::pair();
    let transport_map = TransportMap::new();
    transport_map
        .insert("n1".into(), Arc::new(t_neighbor))
        .await;

    engine
        .execute_decision(envelope("src", "target"), &decision, &transport_map)
        .await
        .unwrap();

    let received = t_mirror.recv().await.unwrap().expect("should receive");
    match received {
        LinkMessage::Envelope(env) => assert_eq!(env.kind, "test.ping"),
        other => panic!("expected Envelope, got: {:?}", other),
    }
}

#[tokio::test]
async fn execute_fallback_to_smallest() {
    let engine = ForwardEngine::new_no_filters("r1".into());

    let env = envelope("src", "unknown");
    let decision = engine.process_envelope(env, None, false).await;

    let (t_a, t_a_mirror) = InMemoryTransport::pair();
    let (t_z, t_z_mirror) = InMemoryTransport::pair();

    let transport_map = TransportMap::new();
    transport_map
        .insert("upstream-z".into(), Arc::new(t_z))
        .await;
    transport_map
        .insert("upstream-a".into(), Arc::new(t_a))
        .await;

    engine
        .execute_decision(envelope("src", "unknown"), &decision, &transport_map)
        .await
        .unwrap();

    // Should forward to upstream-a (smallest)
    let received = t_a_mirror.recv().await.unwrap().expect("should receive");
    assert!(matches!(received, LinkMessage::Envelope(_)));

    // upstream-z should not receive anything.
    drop(transport_map);
    let result = t_z_mirror.recv().await.unwrap();
    assert!(result.is_none(), "upstream-z should not receive");
}

#[tokio::test]
async fn tap_events_are_emitted() {
    let engine = ForwardEngine::new_no_filters("r1".into());
    let mut tap_rx = engine.tap_subscribe();

    let ann = RouteAnnouncement::local(addr("target"));
    engine
        .route_table()
        .write()
        .await
        .upsert_announcement(&ann, "n1");

    let env = envelope("src", "target");
    let _decision = engine.process_envelope(env, None, false).await;

    let mut count = 0;
    while let Ok(event) = tap_rx.try_recv() {
        count += 1;
        match event {
            TapEvent::EnvelopeReceived { .. } | TapEvent::ForwardDecided { .. } => {}
            other => panic!("unexpected tap event: {:?}", other),
        }
    }
    assert!(count >= 2, "should emit at least 2 tap events, got {count}");
}

#[tokio::test]
async fn split_horizon_avoids_source() {
    let engine = ForwardEngine::new_no_filters("r1".into());

    let ann = RouteAnnouncement::local(addr("target"));
    engine
        .route_table()
        .write()
        .await
        .upsert_announcement(&ann, "n1");

    // Envelope from n1 → should not route back to n1
    let env = envelope("src", "target");
    let decision = engine.process_envelope(env, Some("n1"), false).await;

    match decision.plan {
        ForwardPlan::NoRoute { .. } | ForwardPlan::Drop { .. } => {}
        other => panic!(
            "expected NoRoute/Drop due to split horizon, got: {:?}",
            other
        ),
    }
}

#[tokio::test]
async fn metrics_snapshot_counts() {
    let engine = ForwardEngine::new_no_filters("r1".into());

    let ann = RouteAnnouncement::local(addr("target"));
    engine
        .route_table()
        .write()
        .await
        .upsert_announcement(&ann, "n1");

    let (t, _mirror) = InMemoryTransport::pair();
    let transport_map = TransportMap::new();
    transport_map.insert("n1".into(), Arc::new(t)).await;

    for _ in 0..3 {
        let env = envelope("src", "target");
        let decision = engine.process_envelope(env, None, false).await;
        engine
            .execute_decision(envelope("src", "target"), &decision, &transport_map)
            .await
            .unwrap();
    }

    let snap = engine.metrics_snapshot();
    assert_eq!(snap.forwarded_total, 3);
}

// ── Rule integration tests ──────────────────────────────────────────

fn make_rule(id: &str, priority: u32, matcher: RuleMatcher, action: RuleAction) -> Rule {
    Rule {
        id: id.to_string(),
        priority,
        enabled: true,
        matcher,
        action,
        revision: 0,
    }
}

/// Build a ForwardEngine with a shared RuleTable for rule tests.
/// Must be called from outside a tokio runtime (uses blocking_write).
fn engine_with_rules(rules: Vec<Rule>) -> (ForwardEngine, Arc<RwLock<RuleTable>>) {
    let rule_table = Arc::new(RwLock::new(RuleTable::default()));
    {
        let mut rt = rule_table.blocking_write();
        for rule in rules {
            rt.add_rule(rule);
        }
    }
    let engine = ForwardEngine::new_with_rule_table("r1".into(), vec![], rule_table.clone());
    (engine, rule_table)
}

/// Build a ForwardEngine with a shared RuleTable for rule tests (async version).
async fn engine_with_rules_async(rules: Vec<Rule>) -> (ForwardEngine, Arc<RwLock<RuleTable>>) {
    let rule_table = Arc::new(RwLock::new(RuleTable::default()));
    {
        let mut rt = rule_table.write().await;
        for rule in rules {
            rt.add_rule(rule);
        }
    }
    let engine = ForwardEngine::new_with_rule_table("r1".into(), vec![], rule_table.clone());
    (engine, rule_table)
}

#[tokio::test]
async fn rule_drop_kills_envelope() {
    // Rule: drop all upload messages
    let (engine, _) = engine_with_rules_async(vec![make_rule(
        "drop-upload",
        10,
        RuleMatcher {
            link_type: Some("upload".into()),
            ..Default::default()
        },
        RuleAction::Drop {
            reason: "upload blocked".into(),
        },
    )])
    .await;

    let mut env = envelope("src", "target");
    env.link_type = "upload".into();

    let decision = engine.process_envelope(env, None, false).await;

    match decision.plan {
        ForwardPlan::Drop { reason } => {
            assert!(reason.contains("rule drop"), "reason: {reason}");
            assert!(reason.contains("upload blocked"), "reason: {reason}");
        }
        other => panic!("expected Drop, got: {:?}", other),
    }
    assert_eq!(decision.matched_rule_id, Some("drop-upload".into()));
    assert_eq!(engine.metrics_snapshot().rule_dropped_total, 1);
}

#[tokio::test]
async fn rule_force_neighbor_overrides_route() {
    // Route: target → n1
    // Rule: force all messages to n2
    let (engine, _) = engine_with_rules_async(vec![make_rule(
        "force-n2",
        5,
        RuleMatcher::default(), // match everything
        RuleAction::ForceNeighbor {
            neighbor_id: "n2".into(),
        },
    )])
    .await;

    let ann = RouteAnnouncement::local(addr("target"));
    engine
        .route_table()
        .write()
        .await
        .upsert_announcement(&ann, "n1");

    let env = envelope("src", "target");
    let decision = engine.process_envelope(env, None, false).await;

    match decision.plan {
        ForwardPlan::ForwardNeighbor { neighbor_id } => {
            assert_eq!(neighbor_id, "n2");
        }
        other => panic!("expected ForwardNeighbor(n2), got: {:?}", other),
    }
    assert_eq!(decision.matched_rule_id, Some("force-n2".into()));
}

#[tokio::test]
async fn rule_deny_neighbor_avoids_in_route() {
    // Route: target → n1 (distance 1) and n2 (distance 2)
    // Rule: deny n1
    // Expected: route to n2 (next best after n1 is denied)
    let (engine, _) = engine_with_rules_async(vec![make_rule(
        "deny-n1",
        10,
        RuleMatcher::default(),
        RuleAction::DenyNeighbor {
            neighbor_id: "n1".into(),
        },
    )])
    .await;

    // Use insert_manual to ensure both entries exist in the same bucket.
    {
        let rt = engine.route_table();
        let mut rt = rt.write().await;
        rt.insert_manual(addr("target"), "n1", 1);
        rt.insert_manual(addr("target"), "n2", 2);
    }

    let env = envelope("src", "target");
    let decision = engine.process_envelope(env, None, false).await;

    match decision.plan {
        ForwardPlan::ForwardNeighbor { neighbor_id } => {
            assert_eq!(neighbor_id, "n2", "should skip n1 and route to n2");
        }
        other => panic!("expected ForwardNeighbor(n2), got: {:?}", other),
    }
    assert_eq!(decision.matched_rule_id, Some("deny-n1".into()));
}

#[tokio::test]
async fn rule_continue_falls_through_to_route() {
    // Rule: continue (no-op)
    // Route: target → n1
    let (engine, _) = engine_with_rules_async(vec![make_rule(
        "pass",
        10,
        RuleMatcher::default(),
        RuleAction::Continue,
    )])
    .await;

    let ann = RouteAnnouncement::local(addr("target"));
    engine
        .route_table()
        .write()
        .await
        .upsert_announcement(&ann, "n1");

    let env = envelope("src", "target");
    let decision = engine.process_envelope(env, None, false).await;

    match decision.plan {
        ForwardPlan::ForwardNeighbor { neighbor_id } => {
            assert_eq!(neighbor_id, "n1");
        }
        other => panic!("expected ForwardNeighbor(n1), got: {:?}", other),
    }
    // Continue rule matches but matched_rule_id is still recorded
    assert_eq!(decision.matched_rule_id, Some("pass".into()));
}

#[tokio::test]
async fn rule_no_match_uses_route_table() {
    // Rule: only matches "upload" link_type
    // Envelope: link_type = "control"
    // Route: target → n1
    let (engine, _) = engine_with_rules_async(vec![make_rule(
        "upload-only",
        10,
        RuleMatcher {
            link_type: Some("upload".into()),
            ..Default::default()
        },
        RuleAction::Drop {
            reason: "blocked".into(),
        },
    )])
    .await;

    let ann = RouteAnnouncement::local(addr("target"));
    engine
        .route_table()
        .write()
        .await
        .upsert_announcement(&ann, "n1");

    let env = envelope("src", "target"); // kind="test.ping", link_type not "upload"
    let decision = engine.process_envelope(env, None, false).await;

    match decision.plan {
        ForwardPlan::ForwardNeighbor { neighbor_id } => {
            assert_eq!(neighbor_id, "n1");
        }
        other => panic!("expected ForwardNeighbor(n1), got: {:?}", other),
    }
    assert!(
        decision.matched_rule_id.is_none(),
        "no rule should match control traffic"
    );
}

#[tokio::test]
async fn rule_disabled_rule_does_not_match() {
    // Rule: drop all, but disabled
    let rule_table = Arc::new(RwLock::new(RuleTable::default()));
    {
        let mut rt = rule_table.write().await;
        rt.add_rule(make_rule(
            "disabled-drop",
            10,
            RuleMatcher::default(),
            RuleAction::Drop {
                reason: "should not fire".into(),
            },
        ));
        rt.disable_rule("disabled-drop");
    }
    let engine = ForwardEngine::new_with_rule_table("r1".into(), vec![], rule_table);

    let ann = RouteAnnouncement::local(addr("target"));
    engine
        .route_table()
        .write()
        .await
        .upsert_announcement(&ann, "n1");

    let env = envelope("src", "target");
    let decision = engine.process_envelope(env, None, false).await;

    match decision.plan {
        ForwardPlan::ForwardNeighbor { neighbor_id } => {
            assert_eq!(neighbor_id, "n1");
        }
        other => panic!("expected ForwardNeighbor, got: {:?}", other),
    }
    assert!(decision.matched_rule_id.is_none());
}

#[tokio::test]
async fn rule_priority_ordering() {
    // Two rules: low priority (100) drops, high priority (10) forces n2
    // High priority should win
    let (engine, _) = engine_with_rules_async(vec![
        make_rule(
            "low-priority-drop",
            100,
            RuleMatcher::default(),
            RuleAction::Drop {
                reason: "should not fire".into(),
            },
        ),
        make_rule(
            "high-priority-force",
            10,
            RuleMatcher::default(),
            RuleAction::ForceNeighbor {
                neighbor_id: "n2".into(),
            },
        ),
    ])
    .await;

    let ann = RouteAnnouncement::local(addr("target"));
    engine
        .route_table()
        .write()
        .await
        .upsert_announcement(&ann, "n1");

    let env = envelope("src", "target");
    let decision = engine.process_envelope(env, None, false).await;

    match decision.plan {
        ForwardPlan::ForwardNeighbor { neighbor_id } => {
            assert_eq!(neighbor_id, "n2");
        }
        other => panic!("expected ForwardNeighbor(n2), got: {:?}", other),
    }
    assert_eq!(decision.matched_rule_id, Some("high-priority-force".into()));
}

#[tokio::test]
async fn rule_subtype_matching() {
    // Rule: only drop control/add_prompt
    let (engine, _) = engine_with_rules_async(vec![make_rule(
        "block-add-prompt",
        10,
        RuleMatcher {
            link_type: Some("control".into()),
            subtype: Some("add_prompt".into()),
            ..Default::default()
        },
        RuleAction::Drop {
            reason: "add_prompt blocked".into(),
        },
    )])
    .await;

    // Should match: control/add_prompt
    let mut env = envelope("src", "target");
    env.link_type = "control".into();
    env.subtype = "add_prompt".into();
    let decision = engine.process_envelope(env, None, false).await;
    assert!(matches!(decision.plan, ForwardPlan::Drop { .. }));
    assert_eq!(decision.matched_rule_id, Some("block-add-prompt".into()));

    // Should NOT match: control/abort_session
    let mut env2 = envelope("src", "target");
    env2.link_type = "control".into();
    env2.subtype = "abort_session".into();

    let ann = RouteAnnouncement::local(addr("target"));
    engine
        .route_table()
        .write()
        .await
        .upsert_announcement(&ann, "n1");

    let decision2 = engine.process_envelope(env2, None, false).await;
    assert!(matches!(decision2.plan, ForwardPlan::ForwardNeighbor { .. }));
    assert!(decision2.matched_rule_id.is_none());
}
