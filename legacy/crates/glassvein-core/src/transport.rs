//! Transport abstraction layer.
//!
//! Provides the `Transport` trait that decouples the forward engine from any
//! specific network stack (WebSocket, TCP, Pingora, etc.). The MVP ships with
//! `InMemoryTransport` for unit/integration testing without real I/O.
//!
//! ## Reserved implementation slots
//!
//! - **Pingora transport** — will live in `glassvein-pingora` as an adapter.
//! - **TCP transport** — can be added as a thin wrapper over `tokio::net::TcpStream`.
//!
//! Neither is implemented yet; the trait is designed to accommodate both.

use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use glassvein_protocol::WireMessage;
use tokio::sync::{mpsc, RwLock};

// ── Transport trait ─────────────────────────────────────────────────

/// A bidirectional, message-oriented connection to a single remote peer.
///
/// Implementations may wrap WebSocket, TCP+framing, or in-memory channels.
/// The forward engine sends and receives `WireMessage` values through this
/// trait without knowing the underlying transport.
#[async_trait]
pub trait Transport: Send + Sync + 'static {
    /// Send a wire message to the remote end.
    async fn send(&self, message: WireMessage) -> Result<()>;

    /// Receive the next wire message. Returns `Ok(None)` when the remote
    /// end has closed the connection.
    async fn recv(&self) -> Result<Option<WireMessage>>;

    /// Gracefully close the transport.
    async fn close(&self) -> Result<()>;
}

// ── TransportFactory trait ──────────────────────────────────────────

/// Factory for creating transports. Server-side factories accept incoming
/// connections; client-side factories connect to a remote address.
#[async_trait]
pub trait TransportFactory: Send + Sync + 'static {
    type Transport: Transport;

    /// Accept one incoming connection (server side).
    /// Returns `Ok(None)` when the listener is shut down.
    async fn accept(&self) -> Result<Option<Self::Transport>>;

    /// Connect to a remote endpoint (client side).
    async fn connect(&self, addr: &str) -> Result<Self::Transport>;
}

// ── InMemoryTransport ───────────────────────────────────────────────

/// An in-memory transport backed by unbounded MPSC channels.
///
/// Created in pairs via [`InMemoryTransport::pair`]. Suitable for unit
/// tests and integration tests that exercise the forward engine without
/// real network I/O.
pub struct InMemoryTransport {
    incoming: Arc<tokio::sync::Mutex<mpsc::UnboundedReceiver<WireMessage>>>,
    outgoing: mpsc::UnboundedSender<WireMessage>,
    closed: Arc<std::sync::atomic::AtomicBool>,
}

impl InMemoryTransport {
    /// Create a connected pair of in-memory transports.
    ///
    /// Messages sent on `left` arrive at `right.recv()`, and vice versa.
    pub fn pair() -> (Self, Self) {
        let (tx_left, rx_left) = mpsc::unbounded_channel();
        let (tx_right, rx_right) = mpsc::unbounded_channel();

        let closed_left = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let closed_right = Arc::new(std::sync::atomic::AtomicBool::new(false));

        let left = Self {
            incoming: Arc::new(tokio::sync::Mutex::new(rx_right)),
            outgoing: tx_left,
            closed: closed_left,
        };

        let right = Self {
            incoming: Arc::new(tokio::sync::Mutex::new(rx_left)),
            outgoing: tx_right,
            closed: closed_right,
        };

        (left, right)
    }
}

#[async_trait]
impl Transport for InMemoryTransport {
    async fn send(&self, message: WireMessage) -> Result<()> {
        if self.closed.load(std::sync::atomic::Ordering::Relaxed) {
            anyhow::bail!("transport is closed");
        }
        self.outgoing.send(message)?;
        Ok(())
    }

    async fn recv(&self) -> Result<Option<WireMessage>> {
        let mut incoming = self.incoming.lock().await;
        match incoming.recv().await {
            Some(msg) => Ok(Some(msg)),
            None => Ok(None),
        }
    }

    async fn close(&self) -> Result<()> {
        self.closed.store(true, std::sync::atomic::Ordering::Relaxed);
        drop(self.outgoing.clone());
        Ok(())
    }
}

// ── TransportMap ────────────────────────────────────────────────────

/// A thread-safe map of peer/upstream ID → transport.
///
/// Used by the forward engine to look up which transport to use when
/// executing a [`ForwardPlan`](crate::ForwardPlan).
#[derive(Clone, Default)]
pub struct TransportMap {
    transports: Arc<RwLock<HashMap<String, Arc<dyn Transport>>>>,
}

impl TransportMap {
    pub fn new() -> Self {
        Self::default()
    }

    /// Insert or replace a transport for the given ID.
    pub async fn insert(&self, id: String, transport: Arc<dyn Transport>) {
        self.transports.write().await.insert(id, transport);
    }

    /// Remove a transport by ID. Returns `true` if it existed.
    pub async fn remove(&self, id: &str) -> bool {
        self.transports.write().await.remove(id).is_some()
    }

    /// Get a transport by ID.
    pub async fn get(&self, id: &str) -> Option<Arc<dyn Transport>> {
        self.transports.read().await.get(id).cloned()
    }

    /// List all transport IDs.
    pub async fn ids(&self) -> Vec<String> {
        self.transports.read().await.keys().cloned().collect()
    }

    /// Number of active transports.
    pub async fn len(&self) -> usize {
        self.transports.read().await.len()
    }

    /// Get the lexicographically smallest upstream ID and its transport.
    /// Used for deterministic fallback routing.
    pub async fn smallest_id(&self) -> Option<(String, Arc<dyn Transport>)> {
        let map = self.transports.read().await;
        let mut keys: Vec<&String> = map.keys().collect();
        keys.sort();
        keys.first()
            .and_then(|k| map.get(*k).cloned().map(|tx| ((*k).clone(), tx)))
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use glassvein_protocol::{NodeRole, RouteAddress, RouteAnnouncement};

    #[tokio::test]
    async fn in_memory_pair_sends_and_receives() {
        let (left, right) = InMemoryTransport::pair();

        let hello = WireMessage::Hello {
            node_id: "n1".into(),
            role: NodeRole::Router,
            routes: vec![RouteAnnouncement::local(RouteAddress::domain("d1"))],
        };

        left.send(hello.clone()).await.unwrap();

        let received = right.recv().await.unwrap().expect("should receive message");
        match received {
            WireMessage::Hello { node_id, .. } => assert_eq!(node_id, "n1"),
            other => panic!("expected Hello, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn in_memory_bidirectional() {
        let (left, right) = InMemoryTransport::pair();

        let msg_a = WireMessage::Hello {
            node_id: "a".into(),
            role: NodeRole::Client,
            routes: vec![],
        };
        let msg_b = WireMessage::Hello {
            node_id: "b".into(),
            role: NodeRole::Surface,
            routes: vec![],
        };

        left.send(msg_a.clone()).await.unwrap();
        right.send(msg_b.clone()).await.unwrap();

        let recv_b = left.recv().await.unwrap().unwrap();
        let recv_a = right.recv().await.unwrap().unwrap();

        match recv_b {
            WireMessage::Hello { node_id, .. } => assert_eq!(node_id, "b"),
            other => panic!("expected Hello from b, got: {:?}", other),
        }
        match recv_a {
            WireMessage::Hello { node_id, .. } => assert_eq!(node_id, "a"),
            other => panic!("expected Hello from a, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn in_memory_recv_returns_none_on_close() {
        let (left, right) = InMemoryTransport::pair();
        drop(left); // drop sender side

        let result = right.recv().await.unwrap();
        assert!(result.is_none(), "should return None when peer is dropped");
    }

    #[tokio::test]
    async fn transport_map_insert_get_remove() {
        let map = TransportMap::new();
        let (t1, _) = InMemoryTransport::pair();
        let (t2, _) = InMemoryTransport::pair();

        map.insert("p1".into(), Arc::new(t1)).await;
        map.insert("p2".into(), Arc::new(t2)).await;

        assert_eq!(map.len().await, 2);
        assert!(map.get("p1").await.is_some());
        assert!(map.get("p2").await.is_some());
        assert!(map.get("p3").await.is_none());

        assert!(map.remove("p1").await);
        assert_eq!(map.len().await, 1);
        assert!(!map.remove("p1").await);
    }

    #[tokio::test]
    async fn transport_map_smallest_id_deterministic() {
        let map = TransportMap::new();
        let (t_z, _) = InMemoryTransport::pair();
        let (t_a, _) = InMemoryTransport::pair();
        let (t_m, _) = InMemoryTransport::pair();

        map.insert("upstream-z".into(), Arc::new(t_z)).await;
        map.insert("upstream-a".into(), Arc::new(t_a)).await;
        map.insert("upstream-m".into(), Arc::new(t_m)).await;

        let (id, _) = map.smallest_id().await.unwrap();
        assert_eq!(id, "upstream-a");
    }
}
