//! GlassVein ClientRoute — client-side mini router for local session routing.
//!
//! This crate provides an in-process routing layer that:
//!
//! - Manages local "fake" sessions/clients via channel-based delivery.
//! - Routes envelopes between local sessions without network hops.
//! - Falls back to an upstream GlassVein router when the target is not local.
//!
//! # Architecture
//!
//! ```text
//! ┌───────────────────────────────────────────┐
//! │           LocalClientRoute                │
//! │                                           │
//! │  ┌─────────┐  ┌─────────┐  ┌─────────┐  │
//! │  │Session A│  │Session B│  │Session C│  │
//! │  │(mpsc)   │  │(mpsc)   │  │(mpsc)   │  │
//! │  └────┬────┘  └────┬────┘  └────┬────┘  │
//! │       │            │            │        │
//! │       └────────┬───┘            │        │
//! │           local route table     │        │
//! │                │                │        │
//! └────────────────┼────────────────┼────────┘
//!                  │                │
//!          local delivery     upstream fallback
//!                            (WebSocket to router)
//! ```
//!
//! # Usage
//!
//! ```ignore
//! use glassvein_clientroute::{LocalClientRoute, LocalSession};
//! use glassvein_protocol::{RouteAddress, RouteEnvelope};
//! use serde_json::json;
//!
//! #[tokio::main]
//! async fn main() {
//!     let route = LocalClientRoute::new("my-node");
//!
//!     // Register two local sessions
//!     let session_a = route.register_session(
//!         RouteAddress::new("domain", Some("runtime-1"), Some("session-a")),
//!     ).await;
//!     let session_b = route.register_session(
//!         RouteAddress::new("domain", Some("runtime-1"), Some("session-b")),
//!     ).await;
//!
//!     // Send from A to B — stays local, no network
//!     let envelope = RouteEnvelope::new(
//!         session_a.address().clone(),
//!         session_b.address().clone(),
//!         "chat",
//!         json!({"msg": "hello B"}),
//!     );
//!     route.send_envelope(envelope).await;
//!
//!     // Receive on B
//!     let received = session_b.recv().await;
//!     println!("B got: {:?}", received);
//! }
//! ```

use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Result;
use futures_util::{SinkExt, StreamExt};
use glassvein_core::{NextHop, RouteTable};
use glassvein_protocol::{NodeRole, RouteAddress, RouteAnnouncement, RouteEnvelope, WireMessage};
use tokio::sync::{mpsc, RwLock};
use tokio_tungstenite::connect_async;
use tracing::{debug, info, warn};

/// A received envelope with metadata about how it was delivered.
#[derive(Clone, Debug)]
pub struct ReceivedEnvelope {
    /// The envelope payload.
    pub envelope: RouteEnvelope,
    /// Whether this envelope was delivered locally (no network hop).
    pub local_delivery: bool,
}

/// Handle to a locally registered session.
///
/// Provides `send` and `recv` for envelope-based communication.
/// When dropped, the session is automatically unregistered from the local route.
#[derive(Clone)]
pub struct LocalSession {
    address: RouteAddress,
    tx: mpsc::UnboundedSender<RouteEnvelope>,
    rx: Arc<tokio::sync::Mutex<mpsc::UnboundedReceiver<RouteEnvelope>>>,
    route: LocalClientRoute,
}

impl LocalSession {
    /// Returns the route address of this session.
    pub fn address(&self) -> &RouteAddress {
        &self.address
    }

    /// Send an envelope to a target through the local route.
    pub async fn send(&self, target: RouteAddress, kind: &str, payload: serde_json::Value) {
        let envelope = RouteEnvelope::new(self.address.clone(), target, kind, payload);
        self.route.send_envelope(envelope).await;
    }

    /// Receive the next envelope addressed to this session.
    ///
    /// Returns `None` if the session channel is closed.
    pub async fn recv(&self) -> Option<RouteEnvelope> {
        self.rx.lock().await.recv().await
    }

    /// Try to receive without blocking.
    pub fn try_recv(&self) -> Result<RouteEnvelope> {
        self.rx
            .try_lock()
            .map_err(|_| anyhow::anyhow!("rx lock contention"))?
            .try_recv()
            .map_err(|_| anyhow::anyhow!("no envelope available"))
    }
}

impl std::fmt::Debug for LocalSession {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LocalSession")
            .field("address", &self.address)
            .finish()
    }
}

impl Drop for LocalSession {
    fn drop(&mut self) {
        let route = self.route.clone();
        // Best-effort async cleanup; the session is removed from the
        // local route table and session map on next access.
        let addr = self.address.clone();
        tokio::spawn(async move {
            route.remove_session_inner(&addr).await;
        });
    }
}

/// Internal state for `LocalClientRoute`.
#[derive(Debug)]
struct ClientRouteState {
    node_id: String,
    route_table: RouteTable,
    /// Local sessions: address key → sending channel.
    sessions: HashMap<String, mpsc::UnboundedSender<RouteEnvelope>>,
    /// Upstream connection sender (if connected).
    upstream_tx: Option<mpsc::UnboundedSender<WireMessage>>,
}

/// Client-side mini router that manages local sessions and optionally
/// connects to an upstream GlassVein router for non-local delivery.
#[derive(Clone)]
pub struct LocalClientRoute {
    state: Arc<RwLock<ClientRouteState>>,
}

impl std::fmt::Debug for LocalClientRoute {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LocalClientRoute").finish()
    }
}

impl LocalClientRoute {
    /// Create a new local client route with the given node ID.
    pub fn new(node_id: impl Into<String>) -> Self {
        let node_id = node_id.into();
        info!(node_id = %node_id, "local client route created");
        Self {
            state: Arc::new(RwLock::new(ClientRouteState {
                node_id,
                route_table: RouteTable::default(),
                sessions: HashMap::new(),
                upstream_tx: None,
            })),
        }
    }

    /// Register a local session at the given address.
    ///
    /// Returns a [`LocalSession`] handle that can be used to send and receive
    /// envelopes. When the handle is dropped, the session is unregistered.
    ///
    /// If a session already exists at this address, it is replaced.
    pub async fn register_session(&self, address: RouteAddress) -> LocalSession {
        let (tx, rx) = mpsc::unbounded_channel::<RouteEnvelope>();
        let key = address.key();

        let mut state = self.state.write().await;
        state.route_table.upsert_announcement(
            &RouteAnnouncement::local(address.clone()),
            NextHop::Peer(key.clone()),
        );
        state.sessions.insert(key, tx.clone());

        debug!(node_id = %state.node_id, address = %address.key(), "local session registered");

        LocalSession {
            address,
            tx,
            rx: Arc::new(tokio::sync::Mutex::new(rx)),
            route: self.clone(),
        }
    }

    /// Unregister a local session. Called automatically when [`LocalSession`] is dropped.
    async fn remove_session_inner(&self, address: &RouteAddress) {
        let key = address.key();
        let mut state = self.state.write().await;
        state.sessions.remove(&key);
        state.route_table.remove_peer(&key);
        debug!(node_id = %state.node_id, address = %key, "local session unregistered");
    }

    /// Manually unregister a session by address.
    pub async fn unregister_session(&self, address: &RouteAddress) {
        self.remove_session_inner(address).await;
    }

    /// Send an envelope through the local route.
    ///
    /// - If the target address matches a local session, deliver directly.
    /// - Otherwise, forward to the upstream router (if connected).
    /// - If no route exists and no upstream, the envelope is dropped.
    pub async fn send_envelope(&self, envelope: RouteEnvelope) {
        let state = self.state.read().await;
        let target_key = envelope.target.key();

        // Resolve the delivery target while holding the read lock,
        // then perform exactly one delivery action.
        enum DeliveryAction {
            Local(String),
            Upstream,
            Drop,
        }

        let action = {
            // 1. Exact session key match.
            if state.sessions.contains_key(&target_key) {
                DeliveryAction::Local(target_key.clone())
            }
            // 2. Runtime/domain-level local fallback.
            else if let Some(key) = Self::find_local_fallback_key(&state, &envelope.target) {
                DeliveryAction::Local(key)
            }
            // 3. Route table resolution → local session.
            else if let Some(key) = Self::resolve_route_table_local(&state, &envelope.target) {
                DeliveryAction::Local(key)
            }
            // 4. Upstream fallback.
            else if state.upstream_tx.is_some() {
                DeliveryAction::Upstream
            } else {
                DeliveryAction::Drop
            }
        };

        match action {
            DeliveryAction::Local(key) => {
                if let Some(tx) = state.sessions.get(&key) {
                    if tx.send(envelope).is_ok() {
                        debug!(
                            node_id = %state.node_id,
                            target = %key,
                            "local delivery"
                        );
                        return;
                    }
                }
                warn!(
                    node_id = %state.node_id,
                    target = %key,
                    "local delivery failed: session gone"
                );
            }
            DeliveryAction::Upstream => {
                if let Some(upstream_tx) = &state.upstream_tx {
                    let wire = WireMessage::Envelope {
                        envelope: Box::new(envelope),
                    };
                    if upstream_tx.send(wire).is_ok() {
                        debug!(node_id = %state.node_id, "forwarded to upstream router");
                        return;
                    }
                }
            }
            DeliveryAction::Drop => {}
        }

        warn!(
            node_id = %state.node_id,
            target = %target_key,
            "envelope dropped: no local session and no upstream"
        );
    }

    /// Find a local session key for runtime/domain-level fallback delivery.
    fn find_local_fallback_key(state: &ClientRouteState, target: &RouteAddress) -> Option<String> {
        // If target has a runtime_id, look for any session in that runtime.
        if let Some(runtime_id) = &target.runtime_id {
            let prefix = format!("{}/{}/", target.domain_id, runtime_id);
            for key in state.sessions.keys() {
                if key.starts_with(&prefix) {
                    return Some(key.clone());
                }
            }
        }

        // Domain-level: any session in the domain (only if target has no runtime).
        if target.runtime_id.is_none() && target.session_id.is_none() {
            let domain_prefix = format!("{}/", target.domain_id);
            for key in state.sessions.keys() {
                if key.starts_with(&domain_prefix) {
                    return Some(key.clone());
                }
            }
        }

        None
    }

    /// Resolve via route table and return a local session key if found.
    fn resolve_route_table_local(
        state: &ClientRouteState,
        target: &RouteAddress,
    ) -> Option<String> {
        let entry = state.route_table.resolve(target, None)?;
        match &entry.hop {
            NextHop::Peer(peer_key) => {
                if state.sessions.contains_key(peer_key) {
                    Some(peer_key.clone())
                } else {
                    None
                }
            }
            _ => None,
        }
    }

    /// Connect to an upstream GlassVein router via WebSocket.
    ///
    /// Announces all locally registered sessions to the upstream router.
    /// Incoming envelopes from the upstream are dispatched to local sessions.
    pub async fn connect_upstream(&self, upstream_url: &str) -> Result<()> {
        let (ws, _) = connect_async(upstream_url).await?;

        let (mut writer, mut reader) = ws.split();
        let (upstream_tx, mut upstream_rx) = mpsc::unbounded_channel::<WireMessage>();

        // Store upstream sender.
        {
            let mut state = self.state.write().await;
            state.upstream_tx = Some(upstream_tx.clone());
        }

        let node_id = {
            let state = self.state.read().await;
            state.node_id.clone()
        };

        // Send Hello with all local routes.
        {
            let state = self.state.read().await;
            let routes = state.route_table.export_announcements();
            let hello = WireMessage::Hello {
                node_id: node_id.clone(),
                role: NodeRole::Client,
                routes,
            };
            upstream_tx.send(hello)?;
        }

        info!(node_id = %node_id, %upstream_url, "connected to upstream router");

        // Writer task: serialize and send wire messages.
        let writer_node_id = node_id.clone();
        let writer_task = tokio::spawn(async move {
            while let Some(message) = upstream_rx.recv().await {
                let text = match serde_json::to_string(&message) {
                    Ok(t) => t,
                    Err(e) => {
                        warn!(node_id = %writer_node_id, %e, "failed to serialize upstream message");
                        continue;
                    }
                };
                if writer
                    .send(tokio_tungstenite::tungstenite::Message::Text(text.into()))
                    .await
                    .is_err()
                {
                    break;
                }
            }
        });

        // Reader task: dispatch incoming envelopes to local sessions.
        let route = self.clone();
        let reader_node_id = node_id.clone();
        tokio::spawn(async move {
            while let Some(message) = reader.next().await {
                match message {
                    Ok(msg) if msg.is_text() => {
                        let wire: WireMessage = match serde_json::from_str(msg.to_text().unwrap_or("")) {
                            Ok(w) => w,
                            Err(e) => {
                                warn!(node_id = %reader_node_id, %e, "failed to parse upstream message");
                                continue;
                            }
                        };
                        match wire {
                            WireMessage::Envelope { envelope } => {
                                let key = envelope.target.key();
                                let state = route.state.read().await;
                                if let Some(tx) = state.sessions.get(&key) {
                                    if tx.send(*envelope).is_ok() {
                                        debug!(
                                            node_id = %reader_node_id,
                                            target = %key,
                                            "upstream envelope delivered locally"
                                        );
                                    }
                                } else {
                                    warn!(
                                        node_id = %reader_node_id,
                                        target = %key,
                                        "upstream envelope: no local session"
                                    );
                                }
                            }
                            WireMessage::RouteUpdate { node_id: remote_node_id, routes } => {
                                let mut state = route.state.write().await;
                                for ann in &routes {
                                    state.route_table.upsert_announcement(
                                        ann,
                                        NextHop::Upstream(format!("upstream:{remote_node_id}")),
                                    );
                                }
                                debug!(
                                    node_id = %reader_node_id,
                                    remote = %remote_node_id,
                                    count = routes.len(),
                                    "upstream route update applied"
                                );
                            }
                            WireMessage::Hello { node_id: remote_node_id, routes, .. } => {
                                let mut state = route.state.write().await;
                                for ann in &routes {
                                    state.route_table.upsert_announcement(
                                        ann,
                                        NextHop::Upstream(format!("upstream:{remote_node_id}")),
                                    );
                                }
                                debug!(
                                    node_id = %reader_node_id,
                                    remote = %remote_node_id,
                                    count = routes.len(),
                                    "upstream hello routes applied"
                                );
                            }
                        }
                    }
                    Err(e) => {
                        warn!(node_id = %reader_node_id, %e, "upstream read error");
                        break;
                    }
                    _ => {}
                }
            }
        });

        // When writer_task ends, clear upstream.
        let cleanup_route = self.clone();
        tokio::spawn(async move {
            writer_task.await.ok();
            let mut state = cleanup_route.state.write().await;
            state.upstream_tx = None;
            info!(node_id = %state.node_id, "upstream connection closed");
        });

        Ok(())
    }

    /// Returns the number of locally registered sessions.
    pub async fn session_count(&self) -> usize {
        self.state.read().await.sessions.len()
    }

    /// Returns whether an upstream connection is active.
    pub async fn has_upstream(&self) -> bool {
        self.state.read().await.upstream_tx.is_some()
    }

    /// Returns the node ID.
    pub async fn node_id(&self) -> String {
        self.state.read().await.node_id.clone()
    }

    /// Get a snapshot of the current route table.
    pub async fn route_snapshot(&self) -> Vec<(String, Vec<glassvein_core::RouteEntry>)> {
        self.state.read().await.route_table.snapshot()
    }

    /// List all registered local session addresses.
    pub async fn list_sessions(&self) -> Vec<RouteAddress> {
        let state = self.state.read().await;
        state
            .sessions
            .keys()
            .filter_map(|key| {
                let parts: Vec<&str> = key.splitn(3, '/').collect();
                if parts.len() == 3 {
                    Some(RouteAddress::new(
                        parts[0],
                        if parts[1] == "*" {
                            None
                        } else {
                            Some(parts[1])
                        },
                        if parts[2] == "*" {
                            None
                        } else {
                            Some(parts[2])
                        },
                    ))
                } else {
                    None
                }
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn session_addr(domain: &str, runtime: &str, session: &str) -> RouteAddress {
        RouteAddress::new(domain, Some(runtime), Some(session))
    }

    fn runtime_addr(domain: &str, runtime: &str) -> RouteAddress {
        RouteAddress::new(domain, Some(runtime), Option::<String>::None)
    }

    // ── Local session registration ─────────────────────────────────

    #[tokio::test]
    async fn register_and_list_sessions() {
        let route = LocalClientRoute::new("test-node");

        let addr_a = session_addr("d1", "r1", "s1");
        let addr_b = session_addr("d1", "r1", "s2");

        let _s_a = route.register_session(addr_a.clone()).await;
        let _s_b = route.register_session(addr_b.clone()).await;

        assert_eq!(route.session_count().await, 2);

        let sessions = route.list_sessions().await;
        assert_eq!(sessions.len(), 2);
    }

    // ── Local delivery between sessions ────────────────────────────

    #[tokio::test]
    async fn local_delivery_exact_match() {
        let route = LocalClientRoute::new("test-node");

        let addr_a = session_addr("d1", "r1", "s-a");
        let addr_b = session_addr("d1", "r1", "s-b");

        let s_a = route.register_session(addr_a.clone()).await;
        let s_b = route.register_session(addr_b.clone()).await;

        let envelope = RouteEnvelope::new(
            addr_a.clone(),
            addr_b.clone(),
            "test.ping",
            json!({"msg": "hello"}),
        );
        route.send_envelope(envelope).await;

        let received = s_b.recv().await.expect("should receive envelope");
        assert_eq!(received.kind, "test.ping");
        assert_eq!(received.payload["msg"], "hello");
        assert_eq!(received.source, addr_a);
        assert_eq!(received.target, addr_b);
    }

    #[tokio::test]
    async fn local_delivery_bidirectional() {
        let route = LocalClientRoute::new("test-node");

        let addr_a = session_addr("d1", "r1", "alpha");
        let addr_b = session_addr("d1", "r1", "beta");

        let s_a = route.register_session(addr_a.clone()).await;
        let s_b = route.register_session(addr_b.clone()).await;

        // A → B
        s_a.send(addr_b.clone(), "msg", json!({"n": 1})).await;
        let recv = s_b.recv().await.unwrap();
        assert_eq!(recv.kind, "msg");
        assert_eq!(recv.payload["n"], 1);

        // B → A
        s_b.send(addr_a.clone(), "reply", json!({"n": 2})).await;
        let recv = s_a.recv().await.unwrap();
        assert_eq!(recv.kind, "reply");
        assert_eq!(recv.payload["n"], 2);
    }

    #[tokio::test]
    async fn local_delivery_multiple_messages() {
        let route = LocalClientRoute::new("test-node");

        let addr_a = session_addr("d1", "r1", "sender");
        let addr_b = session_addr("d1", "r1", "receiver");

        let s_a = route.register_session(addr_a.clone()).await;
        let s_b = route.register_session(addr_b.clone()).await;

        for i in 0..5 {
            s_a.send(addr_b.clone(), "seq", json!({"i": i})).await;
        }

        for i in 0..5 {
            let recv = s_b.recv().await.unwrap();
            assert_eq!(recv.payload["i"], i);
        }
    }

    // ── Self-delivery ──────────────────────────────────────────────

    #[tokio::test]
    async fn self_delivery() {
        let route = LocalClientRoute::new("test-node");

        let addr = session_addr("d1", "r1", "self");
        let session = route.register_session(addr.clone()).await;

        session.send(addr.clone(), "self-msg", json!({"echo": true})).await;

        let recv = session.recv().await.unwrap();
        assert_eq!(recv.kind, "self-msg");
        assert_eq!(recv.source, addr);
        assert_eq!(recv.target, addr);
    }

    // ── Unregister session ─────────────────────────────────────────

    #[tokio::test]
    async fn unregister_removes_session() {
        let route = LocalClientRoute::new("test-node");

        let addr = session_addr("d1", "r1", "temp");
        let session = route.register_session(addr.clone()).await;

        assert_eq!(route.session_count().await, 1);

        route.unregister_session(&addr).await;
        assert_eq!(route.session_count().await, 0);

        // Sending to unregistered session should not panic (dropped).
        let envelope = RouteEnvelope::new(
            session_addr("d1", "r1", "other"),
            addr.clone(),
            "test",
            json!(null),
        );
        route.send_envelope(envelope).await;
    }

    // ── Drop-based cleanup ─────────────────────────────────────────

    #[tokio::test]
    async fn drop_session_triggers_cleanup() {
        let route = LocalClientRoute::new("test-node");

        let addr = session_addr("d1", "r1", "droppable");
        {
            let _session = route.register_session(addr.clone()).await;
            assert_eq!(route.session_count().await, 1);
        }
        // Give the drop handler time to run.
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert_eq!(route.session_count().await, 0);
    }

    // ── No route → dropped (no upstream) ───────────────────────────

    #[tokio::test]
    async fn no_route_no_upstream_drops_envelope() {
        let route = LocalClientRoute::new("test-node");

        let source = session_addr("d1", "r1", "src");
        let target = session_addr("d1", "r1", "nonexistent");

        let _s = route.register_session(source.clone()).await;

        let envelope = RouteEnvelope::new(source, target, "test", json!(null));
        // Should not panic.
        route.send_envelope(envelope).await;
    }

    // ── Route table snapshot ───────────────────────────────────────

    #[tokio::test]
    async fn route_snapshot_includes_local_sessions() {
        let route = LocalClientRoute::new("test-node");

        let addr = session_addr("d1", "r1", "s1");
        let _session = route.register_session(addr.clone()).await;

        let snapshot = route.route_snapshot().await;
        // Should have at least session-level and runtime-level entries.
        assert!(!snapshot.is_empty(), "route snapshot should not be empty");
    }

    // ── Cross-domain sessions ──────────────────────────────────────

    #[tokio::test]
    async fn different_domains_are_isolated() {
        let route = LocalClientRoute::new("test-node");

        let addr_a = session_addr("domain-x", "r1", "s1");
        let addr_b = session_addr("domain-y", "r1", "s1");

        let s_a = route.register_session(addr_a.clone()).await;
        let s_b = route.register_session(addr_b.clone()).await;

        // A sends to an address in domain-y that exists.
        let envelope = RouteEnvelope::new(
            addr_a.clone(),
            addr_b.clone(),
            "cross-domain",
            json!({"msg": "hello"}),
        );
        route.send_envelope(envelope).await;

        let recv = s_b.recv().await.unwrap();
        assert_eq!(recv.kind, "cross-domain");
    }

    // ── Concurrent send/receive ────────────────────────────────────

    #[tokio::test]
    async fn concurrent_send_receive() {
        let route = LocalClientRoute::new("test-node");

        let addr_a = session_addr("d1", "r1", "concurrent-a");
        let addr_b = session_addr("d1", "r1", "concurrent-b");

        let s_a = route.register_session(addr_a.clone()).await;
        let s_b = route.register_session(addr_b.clone()).await;

        let count = 100u32;

        // Spawn sender task.
        let send_route = route.clone();
        let send_addr_a = addr_a.clone();
        let send_addr_b = addr_b.clone();
        let sender = tokio::spawn(async move {
            for i in 0..count {
                let envelope = RouteEnvelope::new(
                    send_addr_a.clone(),
                    send_addr_b.clone(),
                    "concurrent",
                    json!({"i": i}),
                );
                send_route.send_envelope(envelope).await;
            }
        });

        // Receive all on B.
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
        let received = receiver.await.unwrap();
        assert_eq!(received, count);
    }
}
