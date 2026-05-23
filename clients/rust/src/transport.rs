//! Abstract transport layer for OSGP client connections.

use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use osgp::LinkMessage;
use tokio::sync::{mpsc, RwLock};

/// Abstract transport layer for OSGP client connections.
///
/// Implementations handle the actual network I/O (WebSocket, TCP, in-memory, etc.)
/// while the `Client` operates on protocol-level types.
#[async_trait]
pub trait Transport: Send + Sync + 'static {
    /// Send a link message to the connected router.
    async fn send_message(&self, message: LinkMessage) -> Result<()>;

    /// Receive the next link message from the router.
    /// Returns `None` when the connection is closed.
    async fn receive_message(&self) -> Result<Option<LinkMessage>>;

    /// Check if the transport is currently connected.
    fn is_connected(&self) -> bool;

    /// Close the transport connection.
    async fn close(&self) -> Result<()>;
}

// ───────────────────────────── Fake Transport ─────────────────────────────

/// Hub for creating connected fake transport pairs.
///
/// Useful for simulating multiple clients in the same process.
pub struct FakeTransportHub {
    routes: Arc<RwLock<HashMap<String, mpsc::UnboundedSender<LinkMessage>>>>,
}

impl FakeTransportHub {
    pub fn new() -> Self {
        Self {
            routes: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Create a new fake transport for a given node_id.
    pub async fn create_transport(&self, node_id: &str) -> FakeTransportHandle {
        let (tx, rx) = mpsc::unbounded_channel();

        self.routes
            .write()
            .await
            .insert(node_id.to_string(), tx.clone());

        FakeTransportHandle {
            node_id: node_id.to_string(),
            tx,
            rx: Arc::new(tokio::sync::Mutex::new(rx)),
            routes: self.routes.clone(),
        }
    }

    /// Send a message directly to a node in the hub (for testing).
    pub async fn send_to(&self, target_node: &str, message: LinkMessage) -> Result<()> {
        let routes = self.routes.read().await;
        if let Some(tx) = routes.get(target_node) {
            tx.send(message)
                .map_err(|e| anyhow::anyhow!("send to {} failed: {}", target_node, e))
        } else {
            anyhow::bail!("node {} not found in hub", target_node)
        }
    }
}

impl Default for FakeTransportHub {
    fn default() -> Self {
        Self::new()
    }
}

/// Handle for a fake transport, implementing the Transport trait.
pub struct FakeTransportHandle {
    node_id: String,
    tx: mpsc::UnboundedSender<LinkMessage>,
    rx: Arc<tokio::sync::Mutex<mpsc::UnboundedReceiver<LinkMessage>>>,
    routes: Arc<RwLock<HashMap<String, mpsc::UnboundedSender<LinkMessage>>>>,
}

#[async_trait]
impl Transport for FakeTransportHandle {
    async fn send_message(&self, message: LinkMessage) -> Result<()> {
        self.tx
            .send(message)
            .map_err(|e| anyhow::anyhow!("send failed: {}", e))
    }

    async fn receive_message(&self) -> Result<Option<LinkMessage>> {
        let mut rx = self.rx.lock().await;
        Ok(rx.recv().await)
    }

    fn is_connected(&self) -> bool {
        !self.tx.is_closed()
    }

    async fn close(&self) -> Result<()> {
        self.routes.write().await.remove(&self.node_id);
        Ok(())
    }
}
