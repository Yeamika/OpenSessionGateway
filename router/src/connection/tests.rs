//! Connection manager tests.

use std::sync::Arc;

use osgp::SessionAddress;
use tokio::sync::{broadcast, mpsc};

use crate::tap::{EnvelopeSummary, TapEvent};
use crate::transport::{PeerHandle, PeerRole, UpstreamHandle};

use super::ConnectionManager;

fn make_manager(node_id: &str) -> Arc<ConnectionManager> {
    let (tap_tx, _) = broadcast::channel(64);
    Arc::new(ConnectionManager::new(node_id.into(), Some(tap_tx)))
}

#[tokio::test]
async fn register_and_query_peers() {
    let mgr = make_manager("router-1");

    // Manually insert a peer
    let (tx, _rx) = mpsc::unbounded_channel();
    let handle = PeerHandle::new("client-a", PeerRole::Endpoint, tx);
    mgr.peers.write().await.insert("client-a".into(), handle);

    let peers = mgr.connected_peers().await;
    assert_eq!(peers.len(), 1);
    assert!(peers.contains(&"client-a".to_string()));
}

#[tokio::test]
async fn unregister_cleans_up() {
    let mgr = make_manager("router-1");

    // Insert peer with routes
    let (tx, _rx) = mpsc::unbounded_channel();
    let handle = PeerHandle::new("client-a", PeerRole::Endpoint, tx);
    mgr.peers.write().await.insert("client-a".into(), handle);
    mgr.peer_routes.write().await.insert(
        "client-a".into(),
        vec![SessionAddress::new("dom-a", None, None)],
    );

    mgr.unregister_peer("client-a").await;

    assert!(mgr.peers.read().await.is_empty());
    assert!(mgr.peer_routes.read().await.is_empty());
}

#[tokio::test]
async fn upstream_queries() {
    let mgr = make_manager("router-1");

    // No upstream initially
    assert!(mgr.upstream_node_id().await.is_none());

    // Set upstream
    let (tx, _rx) = mpsc::unbounded_channel();
    let handle = UpstreamHandle::new("parent-router", tx);
    *mgr.upstream.write().await = Some(handle);

    assert_eq!(
        mgr.upstream_node_id().await.as_deref(),
        Some("parent-router")
    );
}

#[tokio::test]
async fn tap_subscription() {
    let mgr = make_manager("router-1");
    let mut rx = mgr.subscribe_tap().unwrap();

    // Emit a tap event
    let event = TapEvent::DropTtl {
        summary: EnvelopeSummary {
            id: "test".into(),
            source: "a".into(),
            target: "b".into(),
            kind: "test".into(),
            ttl: 0,
        },
    };
    mgr.tap_tx.as_ref().unwrap().send(event).unwrap();

    let received = rx.try_recv().unwrap();
    assert!(matches!(received, TapEvent::DropTtl { .. }));
}

#[tokio::test]
async fn learn_route_from_peer() {
    let mgr = make_manager("router-1");

    mgr.learn_route_from_peer("peer-a", SessionAddress::new("dom-a", None, None), 0)
        .await;

    let routes = mgr.peer_routes.read().await;
    assert!(routes.contains_key("peer-a"));
    assert_eq!(routes["peer-a"].len(), 1);
}
