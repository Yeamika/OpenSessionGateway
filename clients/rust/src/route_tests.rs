//! ClientRoute tests.

use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use osgp::{LinkMessage, SessionAddress, SessionEnvelope};
use serde_json::json;

use super::route::{ClientRouteTransport, LocalClientRoute};

/// Helper: create a session-level `SessionAddress`.
fn saddr(domain: &str, runtime: &str, session: &str) -> SessionAddress {
    SessionAddress::new(domain, Some(runtime.to_string()), Some(session.to_string()))
}

// ── Registration ────────────────────────────────────────────────

#[tokio::test]
async fn register_and_count_sessions() {
    let route = LocalClientRoute::new("test-node");

    let _a = route.register_session(saddr("d1", "r1", "s1")).await;
    let _b = route.register_session(saddr("d1", "r1", "s2")).await;

    assert_eq!(route.session_count().await, 2);

    let sessions = route.list_sessions().await;
    assert_eq!(sessions.len(), 2);
}

// ── Exact local delivery ────────────────────────────────────────

#[tokio::test]
async fn local_delivery_exact_match() {
    let route = LocalClientRoute::new("test-node");

    let addr_a = saddr("d1", "r1", "alpha");
    let addr_b = saddr("d1", "r1", "beta");

    let _s_a = route.register_session(addr_a.clone()).await;
    let s_b = route.register_session(addr_b.clone()).await;

    let envelope = SessionEnvelope::new(
        addr_a.clone(),
        addr_b.clone(),
        "test.ping",
        json!({"msg": "hello"}),
    );
    route.send_envelope(envelope).await;

    let recv = s_b.recv().await.expect("B should receive");
    assert_eq!(recv.kind, "test.ping");
    assert_eq!(recv.payload["msg"], "hello");
    assert_eq!(recv.source, addr_a);
    assert_eq!(recv.target, addr_b);
}

// ── Bidirectional ───────────────────────────────────────────────

#[tokio::test]
async fn bidirectional_local_delivery() {
    let route = LocalClientRoute::new("test-node");

    let addr_a = saddr("d1", "r1", "a");
    let addr_b = saddr("d1", "r1", "b");

    let s_a = route.register_session(addr_a.clone()).await;
    let s_b = route.register_session(addr_b.clone()).await;

    for i in 0..5 {
        s_a.send_envelope(addr_b.clone(), "seq", json!({"i": i}))
            .await;
    }

    for i in 0..5 {
        let r = s_b.recv().await.unwrap();
        assert_eq!(r.payload["i"], i);
    }
}

// ── Self delivery ───────────────────────────────────────────────

#[tokio::test]
async fn self_delivery() {
    let route = LocalClientRoute::new("test-node");

    let addr = saddr("d1", "r1", "self");
    let session = route.register_session(addr.clone()).await;

    session
        .send_envelope(addr.clone(), "self-msg", json!({"echo": true}))
        .await;

    let r = session.recv().await.unwrap();
    assert_eq!(r.kind, "self-msg");
    assert_eq!(r.source, addr);
    assert_eq!(r.target, addr);
}

// ── Unregister session ──────────────────────────────────────────

#[tokio::test]
async fn unregister_session() {
    let route = LocalClientRoute::new("test-node");

    let addr = saddr("d1", "r1", "temp");
    let _session = route.register_session(addr.clone()).await;
    assert_eq!(route.session_count().await, 1);

    route.unregister_session(&addr).await;
    assert_eq!(route.session_count().await, 0);
}

// ── Drop cleanup ────────────────────────────────────────────────

#[tokio::test]
async fn drop_session_cleanup() {
    let route = LocalClientRoute::new("test-node");

    let addr = saddr("d1", "r1", "droppable");
    {
        let _session = route.register_session(addr).await;
        assert_eq!(route.session_count().await, 1);
    }
    // Give the drop handler time to run.
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;
    assert_eq!(route.session_count().await, 0);
}

// ── No route → dropped (no upstream) ────────────────────────────

#[tokio::test]
async fn no_route_no_upstream_drops_silently() {
    let route = LocalClientRoute::new("test-node");

    let source = saddr("d1", "r1", "src");
    let target = saddr("d1", "r1", "nonexistent");

    let _s = route.register_session(source).await;

    let envelope = SessionEnvelope::new(target.clone(), target, "test", json!(null));
    // Should not panic.
    route.send_envelope(envelope).await;
}

// ── Cross-domain delivery ───────────────────────────────────────

#[tokio::test]
async fn cross_domain_delivery() {
    let route = LocalClientRoute::new("test-node");

    let addr_x = saddr("domain-x", "r1", "s1");
    let addr_y = saddr("domain-y", "r1", "s1");

    let s_x = route.register_session(addr_x.clone()).await;
    let s_y = route.register_session(addr_y.clone()).await;

    let envelope = SessionEnvelope::new(
        s_x.address().clone(),
        addr_y.clone(),
        "cross-domain",
        json!({"msg": "hello"}),
    );
    route.send_envelope(envelope).await;

    let r = s_y.recv().await.unwrap();
    assert_eq!(r.kind, "cross-domain");
}

// ── deliver_from_upstream ───────────────────────────────────────

#[tokio::test]
async fn deliver_from_upstream_to_local_session() {
    let route = LocalClientRoute::new("test-node");

    let addr = saddr("d1", "r1", "remote-target");
    let session = route.register_session(addr.clone()).await;

    let envelope = SessionEnvelope::new(
        saddr("d2", "r2", "remote-source"),
        addr.clone(),
        "upstream.msg",
        json!({"from": "remote"}),
    );

    let delivered = route.deliver_from_upstream(envelope).await.unwrap();
    assert!(delivered);

    let r = session.recv().await.unwrap();
    assert_eq!(r.kind, "upstream.msg");
}

#[tokio::test]
async fn deliver_from_upstream_no_matching_session() {
    let route = LocalClientRoute::new("test-node");

    let envelope = SessionEnvelope::new(
        saddr("d1", "r1", "src"),
        saddr("d1", "r1", "nonexistent"),
        "test",
        json!(null),
    );

    let delivered = route.deliver_from_upstream(envelope).await.unwrap();
    assert!(!delivered);
}

// ── Upstream transport integration ──────────────────────────────

/// A mock upstream transport that records sent messages.
struct MockUpstream {
    sent: Arc<tokio::sync::Mutex<Vec<LinkMessage>>>,
}

impl MockUpstream {
    fn new() -> Self {
        Self {
            sent: Arc::new(tokio::sync::Mutex::new(Vec::new())),
        }
    }
}

#[async_trait]
impl ClientRouteTransport for MockUpstream {
    async fn send_link(&self, message: LinkMessage) -> Result<()> {
        self.sent.lock().await.push(message);
        Ok(())
    }

    async fn recv_link(&self) -> Result<Option<LinkMessage>> {
        Ok(None)
    }
}

#[tokio::test]
async fn upstream_fallback_for_unknown_target() {
    let route = LocalClientRoute::new("test-node");

    let mock = Arc::new(MockUpstream::new());
    route.set_upstream(Some(mock.clone())).await;

    let source = saddr("d1", "r1", "local-client");
    let target = saddr("d2", "r2", "remote-session");

    let _s = route.register_session(source.clone()).await;

    let envelope = SessionEnvelope::new(source, target.clone(), "remote.ping", json!({}));
    route.send_envelope(envelope).await;

    let sent = mock.sent.lock().await;
    assert_eq!(sent.len(), 1);
    match &sent[0] {
        LinkMessage::Envelope(env) => {
            assert_eq!(env.kind, "remote.ping");
            assert_eq!(env.target, target);
        }
        other => panic!("expected Envelope, got {other:?}"),
    }
}

#[tokio::test]
async fn local_delivery_preferred_over_upstream() {
    let route = LocalClientRoute::new("test-node");

    let mock = Arc::new(MockUpstream::new());
    route.set_upstream(Some(mock.clone())).await;

    let addr_a = saddr("d1", "r1", "local-a");
    let addr_b = saddr("d1", "r1", "local-b");

    let _s_a = route.register_session(addr_a.clone()).await;
    let s_b = route.register_session(addr_b.clone()).await;

    let envelope = SessionEnvelope::new(addr_a, addr_b.clone(), "local.msg", json!({"x": 1}));
    route.send_envelope(envelope).await;

    // Should NOT hit upstream.
    let sent = mock.sent.lock().await;
    assert!(sent.is_empty(), "local delivery should not reach upstream");

    // s_b should receive it.
    let r = s_b.recv().await.unwrap();
    assert_eq!(r.kind, "local.msg");
    assert_eq!(r.payload["x"], 1);
}

// ── Concurrent send/receive ─────────────────────────────────────

#[tokio::test]
async fn concurrent_send_receive() {
    let route = LocalClientRoute::new("test-node");

    let addr_a = saddr("d1", "r1", "concurrent-a");
    let addr_b = saddr("d1", "r1", "concurrent-b");

    let _s_a = route.register_session(addr_a.clone()).await;
    let s_b = route.register_session(addr_b.clone()).await;

    let count: u32 = 100;

    // Spawn sender.
    let send_route = route.clone();
    let send_src = addr_a;
    let send_tgt = addr_b;
    let sender = tokio::spawn(async move {
        for i in 0..count {
            let env = SessionEnvelope::new(
                send_src.clone(),
                send_tgt.clone(),
                "concurrent",
                json!({"i": i}),
            );
            send_route.send_envelope(env).await;
        }
    });

    // Receiver on B.
    let receiver = tokio::spawn(async move {
        let mut received = 0u32;
        while let Some(env) = s_b.recv().await {
            assert_eq!(env.kind, "concurrent");
            received += 1;
            if received == count {
                break;
            }
        }
        received
    });

    sender.await.unwrap();
    let total = receiver.await.unwrap();
    assert_eq!(total, count);
}

// ── Address key roundtrip ───────────────────────────────────────

#[test]
fn address_key_roundtrip_session_level() {
    let addr = saddr("dom", "rt", "ses");
    let key = super::route::transport::address_key(&addr);
    assert_eq!(key, "dom/rt/ses");

    let parsed = super::route::transport::parse_address_key(&key).unwrap();
    assert_eq!(parsed, addr);
}

#[test]
fn address_key_roundtrip_domain_only() {
    let addr = SessionAddress::new("dom", None, None);
    let key = super::route::transport::address_key(&addr);
    assert_eq!(key, "dom/*/*");

    let parsed = super::route::transport::parse_address_key(&key).unwrap();
    assert_eq!(parsed, addr);
}

// ── Node ID ─────────────────────────────────────────────────────

#[tokio::test]
async fn node_id_returns_configured_value() {
    let route = LocalClientRoute::new("my-client-42");
    assert_eq!(route.node_id().await, "my-client-42");
}
