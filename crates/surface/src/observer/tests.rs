use super::*;
use osgp::SessionEnvelope;
use serde_json::json;
use uuid::Uuid;

fn make_observation(kind: &str, target_domain: &str) -> Observation {
    make_observation_with_router(kind, target_domain, Some("local-router"))
}

fn make_observation_with_router(
    kind: &str,
    target_domain: &str,
    origin_router_id: Option<&str>,
) -> Observation {
    let envelope = SessionEnvelope {
        id: Uuid::new_v4(),
        source: SessionAddress::new("src-domain", Some("src-rt".into()), None),
        target: SessionAddress::new(target_domain, Some("tgt-rt".into()), None),
        link_type: "upload".to_string(),
        subtype: kind.replace('.', "_"),
        kind: kind.to_string(),
        payload: json!({"hello": "world"}),
        ttl: 16,
        route_hops: vec![],
        origin_surface: None,
    };
    Observation {
        envelope,
        direction: Direction::ForwardPeer,
        forwarded_to: Some("peer-1".to_string()),
        observed_at: 1700000000.0,
        note: None,
        origin_router_id: origin_router_id.map(str::to_string),
    }
}

#[test]
fn observation_serde_roundtrip() {
    let obs = make_observation("test.ping", "domain-a");
    let json = serde_json::to_string(&obs).unwrap();
    let de: Observation = serde_json::from_str(&json).unwrap();
    assert_eq!(de.envelope.kind, "test.ping");
    assert_eq!(de.direction, Direction::ForwardPeer);
    assert_eq!(de.forwarded_to.as_deref(), Some("peer-1"));
}

#[test]
fn filter_default_matches_all() {
    let filter = ObserverFilter::default();
    let obs = make_observation("anything", "any-domain");
    assert!(filter.matches(&obs));
}

#[test]
fn filter_target_mismatch() {
    let filter = ObserverFilter {
        target_filter: Some(SessionAddress::new("other-domain", None, None)),
        ..Default::default()
    };
    let obs = make_observation("test", "domain-a");
    assert!(!filter.matches(&obs));
}

#[test]
fn filter_target_match() {
    let filter = ObserverFilter {
        target_filter: Some(SessionAddress::new("domain-a", None, None)),
        ..Default::default()
    };
    let obs = make_observation("test", "domain-a");
    assert!(filter.matches(&obs));
}

#[test]
fn filter_kind_mismatch() {
    let filter = ObserverFilter {
        kind_filter: Some("control.abort".to_string()),
        ..Default::default()
    };
    let obs = make_observation("test.ping", "domain-a");
    assert!(!filter.matches(&obs));
}

#[test]
fn filter_kind_match() {
    let filter = ObserverFilter {
        kind_filter: Some("test.ping".to_string()),
        ..Default::default()
    };
    let obs = make_observation("test.ping", "domain-a");
    assert!(filter.matches(&obs));
}

#[tokio::test]
async fn observer_surface_emit_receive() {
    let (surface, mut rx) = ObserverSurface::new(16);
    assert_eq!(surface.subscriber_count(), 1);

    let obs = make_observation("test.ping", "domain-a");
    surface.emit(obs).expect("should deliver");

    let received = rx.recv().await.expect("should receive");
    assert_eq!(received.envelope.kind, "test.ping");
}

#[tokio::test]
async fn observer_surface_filtered_out() {
    let filter = ObserverFilter {
        kind_filter: Some("control.abort".to_string()),
        ..Default::default()
    };
    let (surface, mut rx) = ObserverSurface::with_filter(16, filter);

    let obs = make_observation("test.ping", "domain-a");
    surface.emit(obs).expect("filtered is ok");

    assert!(rx.try_recv().is_err());
}

#[test]
fn local_child_visible() {
    let filter = ObserverFilter {
        visibility_scope: VisibilityScope::LocalRouter,
        local_router_id: Some("my-router".to_string()),
        ..Default::default()
    };
    let obs = make_observation_with_router("session_update", "domain-a", Some("my-router"));
    assert!(filter.matches(&obs), "local child events should be visible");
}

#[test]
fn sibling_invisible() {
    let filter = ObserverFilter {
        visibility_scope: VisibilityScope::LocalRouter,
        local_router_id: Some("my-router".to_string()),
        ..Default::default()
    };
    let obs = make_observation_with_router("session_update", "domain-a", Some("sibling-router"));
    assert!(
        !filter.matches(&obs),
        "sibling router events should be invisible"
    );
}

#[test]
fn parent_invisible() {
    let filter = ObserverFilter {
        visibility_scope: VisibilityScope::LocalRouter,
        local_router_id: Some("my-router".to_string()),
        ..Default::default()
    };
    let obs = make_observation_with_router("session_update", "domain-a", Some("parent-router"));
    assert!(
        !filter.matches(&obs),
        "parent router events should be invisible"
    );
}

#[test]
fn control_source_visible() {
    let filter = ObserverFilter {
        visibility_scope: VisibilityScope::LocalRouter,
        local_router_id: Some("my-router".to_string()),
        kind_filter: Some("add_prompt".to_string()),
        ..Default::default()
    };
    let mut obs = make_observation_with_router("add_prompt", "domain-a", Some("my-router"));
    obs.envelope.origin_surface = Some("control-surface-1".to_string());
    assert!(
        filter.matches(&obs),
        "control commands on local router should be visible"
    );
}

#[test]
fn control_from_sibling_router_invisible() {
    let filter = ObserverFilter {
        visibility_scope: VisibilityScope::LocalRouter,
        local_router_id: Some("my-router".to_string()),
        kind_filter: Some("add_prompt".to_string()),
        ..Default::default()
    };
    let obs = make_observation_with_router("add_prompt", "domain-a", Some("sibling-router"));
    assert!(
        !filter.matches(&obs),
        "control commands from sibling router should be invisible"
    );
}

#[test]
fn full_tree_sees_everything() {
    let filter = ObserverFilter {
        visibility_scope: VisibilityScope::FullTree,
        local_router_id: Some("my-router".to_string()),
        ..Default::default()
    };
    let obs_local = make_observation_with_router("session_update", "domain-a", Some("my-router"));
    let obs_sibling =
        make_observation_with_router("session_update", "domain-a", Some("sibling-router"));
    let obs_parent =
        make_observation_with_router("session_update", "domain-a", Some("parent-router"));
    assert!(filter.matches(&obs_local));
    assert!(filter.matches(&obs_sibling));
    assert!(filter.matches(&obs_parent));
}

#[test]
fn origin_surface_preserved_in_envelope() {
    let mut obs = make_observation("add_prompt", "domain-a");
    obs.envelope.origin_surface = Some("control-surface-1".to_string());
    assert_eq!(
        obs.envelope.origin_surface.as_deref(),
        Some("control-surface-1")
    );
}
