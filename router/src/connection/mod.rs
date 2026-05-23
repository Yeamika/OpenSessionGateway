//! WebSocket connection management for the router.
//!
//! Provides:
//! - **Listener**: accepts downstream WebSocket connections (endpoint/router)
//! - **Upstream**: connects to parent router (0 or 1 in tree topology)
//! - **Hello handshake**: exchanges node_id, role, and initial route announcements
//!
//! ## Router boundary contract
//!
//! - Peers declare only network roles: `endpoint` or `router`.
//! - Upload fan-out is local-only and keyed by opaque endpoint capabilities
//!   such as `surface_viewer`.
//! - Control/request/response semantics stay in user-layer endpoints; router
//!   forwards by target/address and does not understand surface roles.
//! - Router peers participate in route propagation via Announce messages.

mod config;
mod dispatch;
mod link_io;
mod listener;
mod peer;
#[cfg(feature = "pingora-listener")]
mod pingora_listener;
#[cfg(test)]
mod tests;
mod upstream;
#[allow(dead_code)]
mod writer;

pub use config::{ListenerConfig, UpstreamConfig};
#[cfg(feature = "pingora-listener")]
pub use pingora_listener::{AcceptedLink, LinkAcceptor, PingoraLinkAcceptor};

use std::collections::HashMap;
use std::sync::Arc;

use osgp::{LinkMessage, SessionAddress};
use tokio::sync::{broadcast, Mutex, RwLock};

use crate::tap::TapEvent;
use crate::transport::{PeerHandle, UpstreamHandle};

/// Manages all connections for a router node.
///
/// Holds the listener for downstream peers and an optional upstream connection.
/// Coordinates peer registration, route learning, and tap event distribution.
pub struct ConnectionManager {
    pub node_id: String,
    /// Downstream peers: node_id -> PeerHandle
    pub peers: Arc<RwLock<HashMap<String, PeerHandle>>>,
    /// Per-peer announced addresses (for cleanup on disconnect)
    pub peer_routes: Arc<RwLock<HashMap<String, Vec<SessionAddress>>>>,
    /// Optional upstream (parent) connection
    pub upstream: Arc<RwLock<Option<UpstreamHandle>>>,
    /// Internal debug tap broadcaster; not part of user-layer OSGP routing.
    pub tap_tx: Option<broadcast::Sender<TapEvent>>,
    /// Callback when a peer connects: (node_id, role, addresses)
    /// Set once during RouterNode::start(), before listener starts.
    pub on_peer_connect:
        Mutex<Option<Arc<dyn Fn(String, crate::transport::PeerRole, Vec<SessionAddress>) + Send + Sync>>>,
    /// Callback when a peer disconnects: (node_id)
    /// Set once during RouterNode::start(), before listener starts.
    pub on_peer_disconnect: Mutex<Option<Arc<dyn Fn(String) + Send + Sync>>>,
    /// Callback when a message is received: (from_id, message)
    /// This is the bridge to RouterNode for forwarding logic.
    /// Uses Mutex for interior mutability so it can be set after construction.
    pub on_message: Mutex<Option<Arc<dyn Fn(String, LinkMessage) -> bool + Send + Sync>>>,
}

impl ConnectionManager {
    pub fn new(node_id: String, tap_tx: Option<broadcast::Sender<TapEvent>>) -> Self {
        Self {
            node_id,
            peers: Arc::new(RwLock::new(HashMap::new())),
            peer_routes: Arc::new(RwLock::new(HashMap::new())),
            upstream: Arc::new(RwLock::new(None)),
            tap_tx,
            on_peer_connect: Mutex::new(None),
            on_peer_disconnect: Mutex::new(None),
            on_message: Mutex::new(None),
        }
    }

    /// Set the message handler callback.
    ///
    /// This callback is invoked when a message is received from a peer.
    /// Return `true` if the message was handled, `false` to use default handling.
    pub async fn set_message_handler(
        &self,
        handler: Arc<dyn Fn(String, LinkMessage) -> bool + Send + Sync>,
    ) {
        *self.on_message.lock().await = Some(handler);
    }

    /// Set the peer connect callback.
    ///
    /// Called when a downstream peer completes the Hello handshake.
    /// Receives (peer_id, role, addresses) from the Hello message.
    pub async fn set_on_peer_connect(
        &self,
        callback: Arc<dyn Fn(String, crate::transport::PeerRole, Vec<SessionAddress>) + Send + Sync>,
    ) {
        *self.on_peer_connect.lock().await = Some(callback);
    }

    /// Set the peer disconnect callback.
    ///
    /// Called when a peer disconnects. Receives the peer's node_id.
    pub async fn set_on_peer_disconnect(&self, callback: Arc<dyn Fn(String) + Send + Sync>) {
        *self.on_peer_disconnect.lock().await = Some(callback);
    }

    /// Subscribe to internal debug tap events.
    ///
    /// Returns `None` if tap is disabled. This is not the surface_viewer
    /// upload fan-out mechanism and must not encode user-layer roles.
    pub fn subscribe_tap(&self) -> Option<broadcast::Receiver<TapEvent>> {
        self.tap_tx.as_ref().map(|tx| tx.subscribe())
    }

    /// Get the list of connected peer IDs.
    pub async fn connected_peers(&self) -> Vec<String> {
        self.peers.read().await.keys().cloned().collect()
    }

    /// Get the upstream node ID, if connected.
    pub async fn upstream_node_id(&self) -> Option<String> {
        self.upstream
            .read()
            .await
            .as_ref()
            .map(|h| h.node_id.clone())
    }

    /// Unregister a peer and clean up its routes.
    pub async fn unregister_peer(&self, peer_id: &str) {
        self.peers.write().await.remove(peer_id);
        self.peer_routes.write().await.remove(peer_id);

        let cb = self.on_peer_disconnect.lock().await;
        if let Some(cb) = cb.as_ref() {
            cb(peer_id.to_string());
        }
    }
}
