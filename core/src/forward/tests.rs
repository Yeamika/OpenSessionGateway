//! Forward engine tests.

use super::*;
use crate::filter::DomainWhitelistFilter;
use crate::route::RouteAnnouncement;
use crate::transport::{InMemoryTransport, Transport};
use serde_json::json;
use osgp::SessionAddress;
use std::sync::Arc;

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
