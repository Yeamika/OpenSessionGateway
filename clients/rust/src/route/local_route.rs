//! LocalClientRoute — in-process mini router with session management.

use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Result;
use osgp::{LinkMessage, SessionAddress, SessionEnvelope};

use super::transport::{address_key, parse_address_key, ClientRouteTransport};

// ─────────────────────── LocalSession ───────────────────────────────

/// Handle to a locally registered session.
///
/// Provides `send_envelope` for sending through the local route and `recv`
/// for receiving envelopes addressed to this session.
///
/// When dropped, the session is automatically unregistered from the
/// `LocalClientRoute` (best-effort async cleanup).
#[derive(Clone)]
pub struct LocalSession {
    address: SessionAddress,
    rx: Arc<tokio::sync::Mutex<tokio::sync::mpsc::UnboundedReceiver<SessionEnvelope>>>,
    route: LocalClientRoute,
}

impl std::fmt::Debug for LocalSession {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LocalSession")
            .field("address", &self.address)
            .finish()
    }
}

impl LocalSession {
    /// Returns the address of this session.
    pub fn address(&self) -> &SessionAddress {
        &self.address
    }

    /// Send an envelope through the local route to a target.
    pub async fn send_envelope(
        &self,
        target: SessionAddress,
        kind: &str,
        payload: serde_json::Value,
    ) {
        let envelope = SessionEnvelope::new(self.address.clone(), target, kind, payload);
        self.route.send_envelope(envelope).await;
    }

    /// Receive the next envelope addressed to this session (await).
    pub async fn recv(&self) -> Option<SessionEnvelope> {
        self.rx.lock().await.recv().await
    }

    /// Try to receive without blocking.
    pub fn try_recv(&self) -> Result<SessionEnvelope> {
        self.rx
            .try_lock()
            .map_err(|_| anyhow::anyhow!("rx lock contention"))?
            .try_recv()
            .map_err(|_| anyhow::anyhow!("no envelope available"))
    }
}

impl Drop for LocalSession {
    fn drop(&mut self) {
        let route = self.route.clone();
        let addr = self.address.clone();
        // Best-effort async cleanup.
        tokio::spawn(async move {
            route.remove_session_inner(&addr).await;
        });
    }
}

// ─────────────────────── Internal state ─────────────────────────────

/// Internal mutable state behind `RwLock`.
struct RouteState {
    node_id: String,
    /// Address key → sender channel for local sessions.
    sessions: HashMap<String, Arc<tokio::sync::mpsc::UnboundedSender<SessionEnvelope>>>,
    /// Optional upstream transport for non-local delivery.
    upstream: Option<Arc<dyn ClientRouteTransport>>,
}

// ─────────────────────── LocalClientRoute ───────────────────────────

/// In-process mini router: manages local sessions via channels and falls
/// back to an upstream transport when the target is not local.
///
/// This is deliberately simple — no distance-vector, no split-horizon.
/// It just checks if the target session is registered locally; if not,
/// it forwards upstream. This keeps the client side lightweight while
/// allowing the real `router` / `core` crates to handle network routing.
#[derive(Clone)]
pub struct LocalClientRoute {
    state: Arc<tokio::sync::RwLock<RouteState>>,
}

impl std::fmt::Debug for LocalClientRoute {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LocalClientRoute").finish()
    }
}

impl LocalClientRoute {
    /// Create a new local client route with the given node identifier.
    pub fn new(node_id: impl Into<String>) -> Self {
        Self {
            state: Arc::new(tokio::sync::RwLock::new(RouteState {
                node_id: node_id.into(),
                sessions: HashMap::new(),
                upstream: None,
            })),
        }
    }

    /// Register a local session at the given address.
    ///
    /// Returns a [`LocalSession`] handle. If a session already exists at this
    /// address, it is replaced.
    pub async fn register_session(&self, address: SessionAddress) -> LocalSession {
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<SessionEnvelope>();
        let key = address_key(&address);
        let tx_arc = Arc::new(tx);

        {
            let mut state = self.state.write().await;
            state.sessions.insert(key, tx_arc.clone());
        }

        LocalSession {
            address,
            rx: Arc::new(tokio::sync::Mutex::new(rx)),
            route: self.clone(),
        }
    }

    /// Internal: remove a session by address.
    async fn remove_session_inner(&self, address: &SessionAddress) {
        let key = address_key(address);
        let mut state = self.state.write().await;
        state.sessions.remove(&key);
    }

    /// Manually unregister a session by address.
    pub async fn unregister_session(&self, address: &SessionAddress) {
        self.remove_session_inner(address).await;
    }

    /// Send an envelope through the local route.
    ///
    /// Delivery order:
    /// 1. Exact address key match → local session channel.
    /// 2. Upstream transport → `send_link`.
    /// 3. Drop (no local match, no upstream).
    pub async fn send_envelope(&self, envelope: SessionEnvelope) {
        let target_key = address_key(&envelope.target);

        // 1. Try exact local delivery.
        let state = self.state.read().await;
        if let Some(tx) = state.sessions.get(&target_key) {
            let tx = tx.clone();
            drop(state);
            let _ = tx.send(envelope);
            return;
        }

        // 2. Upstream transport.
        if let Some(upstream) = &state.upstream {
            let upstream = upstream.clone();
            drop(state);
            let link_msg = LinkMessage::Envelope(envelope);
            let _ = upstream.send_link(link_msg).await;
            return;
        }

        // 3. Drop — silently discarded.
    }

    /// Set or replace the upstream transport for non-local delivery.
    pub async fn set_upstream(&self, transport: Option<Arc<dyn ClientRouteTransport>>) {
        let mut state = self.state.write().await;
        state.upstream = transport;
    }

    /// Returns the number of locally registered sessions.
    pub async fn session_count(&self) -> usize {
        self.state.read().await.sessions.len()
    }

    /// Returns whether an upstream transport is configured.
    pub async fn has_upstream(&self) -> bool {
        self.state.read().await.upstream.is_some()
    }

    /// Returns the node ID.
    pub async fn node_id(&self) -> String {
        self.state.read().await.node_id.clone()
    }

    /// List all registered local session addresses.
    pub async fn list_sessions(&self) -> Vec<SessionAddress> {
        let state = self.state.read().await;
        state
            .sessions
            .keys()
            .filter_map(|key| parse_address_key(key))
            .collect()
    }

    /// Deliver an envelope received from upstream to the matching local session.
    ///
    /// Returns `Ok(true)` if delivered locally, `Ok(false)` if no matching session.
    pub async fn deliver_from_upstream(&self, envelope: SessionEnvelope) -> Result<bool> {
        let key = address_key(&envelope.target);
        let state = self.state.read().await;
        if let Some(tx) = state.sessions.get(&key) {
            tx.send(envelope)?;
            Ok(true)
        } else {
            Ok(false)
        }
    }
}
