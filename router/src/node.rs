//! Router node — main runtime structure.
//!
//! Holds the route table, connection manager, and optional tap broadcaster.
//! Designed for tree topology (0–1 upstream, N downstream).

use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Result;
use gv_core::RouteTable;
use osgp::{LinkMessage, SessionAddress};
use tokio::sync::{broadcast as tokio_broadcast, RwLock};
use tracing::{debug, info, warn};

use crate::config::{ListenerBackend, RouterConfig};
use crate::connection::{ConnectionManager, ListenerConfig, UpstreamConfig};
use crate::envelope_forward;
use crate::read_forward;
use crate::tap::TapEvent;

/// A GlassVein routing node.
pub struct RouterNode {
    pub(crate) config: RouterConfig,
    pub(crate) route_table: Arc<RwLock<RouteTable>>,
    /// Connection manager for all WebSocket connections
    pub connections: Arc<ConnectionManager>,
    /// Per-peer announced addresses (for removal on disconnect).
    pub(crate) peer_routes: Arc<RwLock<HashMap<String, Vec<SessionAddress>>>>,
    /// Optional tap broadcaster
    pub(crate) tap_tx: Option<tokio_broadcast::Sender<TapEvent>>,
}

impl RouterNode {
    pub fn new(config: RouterConfig) -> Self {
        let tap_tx = config
            .tap_capacity
            .map(|cap| tokio_broadcast::channel(cap).0);

        let peer_routes = Arc::new(RwLock::new(HashMap::new()));
        let connections = Arc::new(ConnectionManager::new(
            config.node_id.clone(),
            tap_tx.clone(),
        ));

        Self {
            config,
            route_table: Arc::new(RwLock::new(RouteTable::default())),
            connections,
            peer_routes,
            tap_tx,
        }
    }

    /// Node identifier for this router.
    pub fn node_id(&self) -> &str {
        &self.config.node_id
    }

    /// Subscribe to internal debug tap events.
    ///
    /// Events are local-only diagnostics and are not the OSGP upload fan-out
    /// mechanism exposed through `surface_viewer`.
    pub fn subscribe_tap(&self) -> Option<tokio_broadcast::Receiver<TapEvent>> {
        self.tap_tx.as_ref().map(|tx| tx.subscribe())
    }

    // ── Lifecycle ───────────────────────────────────────────────────

    /// Set up message handler bridge: ConnectionManager → RouterNode
    pub async fn start(self: &Arc<Self>) -> Result<()> {
        // Set up peer connect callback: learn Hello addresses into route table
        // and propagate to upstream. This makes Hello addresses equivalent
        // to Announce messages for route propagation.
        // Note: peer_routes is already updated by ConnectionManager::handle_incoming_link
        // before this callback fires, so we only need to update route_table + upstream.
        {
            let node = Arc::clone(self);
            self.connections
                .set_on_peer_connect(Arc::new(move |peer_id, _role, addresses| {
                    let node = node.clone();
                    tokio::spawn(async move {
                        for address in addresses {
                            // Update route table (peer_routes already updated by ConnectionManager)
                            node.route_table
                                .write()
                                .await
                                .upsert(address.clone(), &peer_id, 0);
                            debug!(
                                router = %node.node_id(),
                                neighbor = %peer_id,
                                address = %crate::format_address(&address),
                                "route learned from Hello"
                            );
                            // Propagate to upstream (same as Announce handling)
                            node.propagate_downstream_route_to_upstream(&peer_id, address, 0)
                                .await;
                        }
                    });
                }))
                .await;
        }

        // Set up peer disconnect callback: remove routes learned from this peer
        {
            let node = Arc::clone(self);
            self.connections
                .set_on_peer_disconnect(Arc::new(move |peer_id| {
                    let node = node.clone();
                    tokio::spawn(async move {
                        let removed = node.route_table.write().await.remove_neighbor(&peer_id);
                        if removed {
                            debug!(
                                router = %node.node_id(),
                                peer = %peer_id,
                                "routes removed from route table after peer disconnect"
                            );
                        }
                    });
                }))
                .await;
        }

        // Set up message handler bridge: ConnectionManager → RouterNode
        self.connections
            .set_message_handler(Arc::new({
                let node = Arc::clone(self);
                move |from_id: String, message: LinkMessage| {
                    let node = node.clone();
                    // We need to spawn the async handler because the callback is sync
                    tokio::spawn(async move {
                        if let Err(e) = node.handle_message(&from_id, message).await {
                            warn!(router = %node.node_id(), error = %e, "message handling failed");
                        }
                    });
                    true // always handled
                }
            }))
            .await;

        // Start downstream listener
        let listener_config = ListenerConfig {
            bind_addr: self.config.bind_addr.clone(),
        };
        let addr = match self.config.listener_backend {
            ListenerBackend::Default => self.connections.start_listener(&listener_config).await?,
            ListenerBackend::Pingora => {
                #[cfg(feature = "pingora-listener")]
                {
                    self.connections
                        .start_pingora_listener(&listener_config)
                        .await?
                }

                #[cfg(not(feature = "pingora-listener"))]
                {
                    anyhow::bail!(
                        "listener backend 'pingora' requires router feature 'pingora-listener'"
                    );
                }
            }
        };
        info!(node_id = %self.config.node_id, addr = %addr, "router started");

        // Connect upstream(s) if configured
        for url in &self.config.upstream_urls {
            let upstream_config = UpstreamConfig {
                url: url.clone(),
                announce_routes: self.config.announce_routes.clone(),
            };
            self.connections.connect_upstream(&upstream_config).await?;
        }

        Ok(())
    }

    // ── Route learning ──────────────────────────────────────────────

    /// Learn a route announced by a neighbor.
    ///
    /// Updates both the core route table and the per-peer bookkeeping.
    pub async fn learn_route(&self, address: SessionAddress, neighbor_id: &str, distance: u32) {
        self.peer_routes
            .write()
            .await
            .entry(neighbor_id.to_string())
            .or_default()
            .push(address.clone());

        self.route_table
            .write()
            .await
            .upsert(address.clone(), neighbor_id, distance);

        debug!(
            router = %self.config.node_id,
            neighbor = %neighbor_id,
            address = %crate::format_address(&address),
            distance,
            "route learned"
        );
    }

    // ── Message processing ──────────────────────────────────────────

    /// Process an incoming link message from a neighbor.
    pub async fn handle_message(&self, from_neighbor: &str, message: LinkMessage) -> Result<()> {
        match message {
            LinkMessage::Announce { address, distance } => {
                self.learn_route(address.clone(), from_neighbor, distance)
                    .await;
                self.propagate_downstream_route_to_upstream(from_neighbor, address, distance)
                    .await;
            }
            LinkMessage::Envelope(envelope) => {
                envelope_forward::forward_envelope(self, from_neighbor, envelope).await;
            }
            LinkMessage::TypedEnvelope(envelope) => {
                envelope_forward::forward_typed_envelope(self, from_neighbor, envelope).await;
            }
            LinkMessage::ReadRequest(request) => {
                let route_table = self.route_table.read().await;
                let tap_tx = self.tap_tx.clone();
                let emit_tap: Arc<dyn Fn(TapEvent) + Send + Sync> = Arc::new(move |event| {
                    if let Some(tx) = &tap_tx {
                        let _ = tx.send(event);
                    }
                });
                read_forward::forward_read_request(
                    &self.config.node_id,
                    &self.connections,
                    &route_table,
                    from_neighbor,
                    request,
                    &emit_tap,
                )
                .await;
            }
            LinkMessage::ReadResponse(response) => {
                let route_table = self.route_table.read().await;
                let tap_tx = self.tap_tx.clone();
                let emit_tap: Arc<dyn Fn(TapEvent) + Send + Sync> = Arc::new(move |event| {
                    if let Some(tx) = &tap_tx {
                        let _ = tx.send(event);
                    }
                });
                read_forward::forward_read_response(
                    &self.config.node_id,
                    &self.connections,
                    &route_table,
                    from_neighbor,
                    response,
                    &emit_tap,
                )
                .await;
            }
            LinkMessage::Ping => {
                debug!(router = %self.config.node_id, from = %from_neighbor, "ping received");
            }
            LinkMessage::Pong => {
                debug!(router = %self.config.node_id, from = %from_neighbor, "pong received");
            }
        }
        Ok(())
    }

    // ── Route propagation ───────────────────────────────────────────

    /// Re-announce a route learned from a downstream peer to the upstream router.
    ///
    /// This keeps tree topologies converged when a child router learns a new
    /// client/session route after its initial upstream Hello. Routes learned
    /// from the upstream itself are not reflected back upstream.
    async fn propagate_downstream_route_to_upstream(
        &self,
        from_neighbor: &str,
        address: SessionAddress,
        distance: u32,
    ) {
        let upstream = self.connections.upstream.read().await;
        let Some(upstream) = upstream.as_ref() else {
            return;
        };
        if upstream.node_id == from_neighbor {
            debug!(
                router = %self.config.node_id,
                upstream = %upstream.node_id,
                address = %crate::format_address(&address),
                "skip reflecting upstream route back to upstream"
            );
            return;
        }

        let announced_distance = distance.saturating_add(1);
        match upstream.send(LinkMessage::Announce {
            address: address.clone(),
            distance: announced_distance,
        }) {
            Ok(()) => {
                debug!(
                    router = %self.config.node_id,
                    upstream = %upstream.node_id,
                    learned_from = %from_neighbor,
                    address = %crate::format_address(&address),
                    distance = announced_distance,
                    "re-announced downstream route to upstream"
                );
            }
            Err(_) => {
                warn!(
                    router = %self.config.node_id,
                    upstream = %upstream.node_id,
                    learned_from = %from_neighbor,
                    address = %crate::format_address(&address),
                    "failed to re-announce downstream route to upstream"
                );
            }
        }
    }

    /// Export routes for announcement to a neighbor (split horizon).
    pub async fn export_routes_for(&self, neighbor_id: &str) -> Vec<(SessionAddress, u32)> {
        let peer_routes = self.peer_routes.read().await;
        let mut result = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for (pid, addrs) in peer_routes.iter() {
            if pid == neighbor_id {
                continue; // split horizon
            }
            for addr in addrs {
                if seen.insert(addr) {
                    result.push((addr.clone(), 1));
                }
            }
        }
        result
    }

    // ── Tap ─────────────────────────────────────────────────────────

    pub(crate) fn emit_tap(&self, event: TapEvent) {
        if let Some(tx) = &self.tap_tx {
            let _ = tx.send(event);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use osgp::{SessionAddress, SessionEnvelope};
    use tokio::sync::mpsc;

    use crate::transport::{PeerHandle, PeerRole, UpstreamHandle};

    pub(crate) fn make_config(node_id: &str) -> RouterConfig {
        RouterConfig::new(node_id, "127.0.0.1:0").with_tap(64)
    }

    pub(crate) fn make_peer(
        node_id: &str,
        role: PeerRole,
    ) -> (PeerHandle, mpsc::UnboundedReceiver<LinkMessage>) {
        let (tx, rx) = mpsc::unbounded_channel();
        let handle = PeerHandle::new(node_id, role, tx);
        (handle, rx)
    }

    pub(crate) fn make_envelope(source: &str, target: &str, kind: &str) -> SessionEnvelope {
        SessionEnvelope::new(
            SessionAddress::new(source, None, None),
            SessionAddress::new(target, None, None),
            kind,
            json!({}),
        )
    }

    // ── Peer lifecycle ──────────────────────────────────────────────

    #[tokio::test]
    async fn register_and_unregister_peer() {
        let node = RouterNode::new(make_config("router-1"));
        let (handle, _rx) = make_peer("client-a", PeerRole::Endpoint);
        node.connections
            .peers
            .write()
            .await
            .insert("client-a".into(), handle);

        assert!(node.connections.peers.read().await.contains_key("client-a"));

        node.connections.unregister_peer("client-a").await;
        assert!(!node.connections.peers.read().await.contains_key("client-a"));
    }

    // ── Route propagation ───────────────────────────────────────────

    #[tokio::test]
    async fn export_routes_for_splits_horizon() {
        let node = RouterNode::new(make_config("router-1"));

        node.learn_route(SessionAddress::new("dom-a", None, None), "peer-a", 0)
            .await;
        node.learn_route(SessionAddress::new("dom-b", None, None), "peer-b", 0)
            .await;

        let routes = node.export_routes_for("peer-a").await;
        assert_eq!(routes.len(), 1);
        assert_eq!(routes[0].0.domain, "dom-b");

        let routes = node.export_routes_for("peer-b").await;
        assert_eq!(routes.len(), 1);
        assert_eq!(routes[0].0.domain, "dom-a");
    }

    #[tokio::test]
    async fn downstream_announce_is_reannounced_to_upstream() {
        let node = RouterNode::new(make_config("child-router"));
        let (tx, mut rx) = mpsc::unbounded_channel();
        *node.connections.upstream.write().await = Some(UpstreamHandle::new("root-router", tx));

        let address = SessionAddress::new("dom-a", Some("rt-a".into()), Some("ses-a".into()));
        node.handle_message(
            "client-a",
            LinkMessage::Announce {
                address: address.clone(),
                distance: 0,
            },
        )
        .await
        .unwrap();

        match rx.try_recv().expect("expected upstream re-announce") {
            LinkMessage::Announce {
                address: announced,
                distance,
            } => {
                assert_eq!(announced, address);
                assert_eq!(distance, 1);
            }
            other => panic!("expected Announce, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn upstream_announce_is_not_reflected_back_upstream() {
        let node = RouterNode::new(make_config("child-router"));
        let (tx, mut rx) = mpsc::unbounded_channel();
        *node.connections.upstream.write().await = Some(UpstreamHandle::new("root-router", tx));

        node.handle_message(
            "root-router",
            LinkMessage::Announce {
                address: SessionAddress::new("dom-a", None, None),
                distance: 1,
            },
        )
        .await
        .unwrap();

        assert!(rx.try_recv().is_err());
    }

    // ── Tap visibility ──────────────────────────────────────────────

    #[tokio::test]
    async fn tap_disabled_by_default() {
        let config = RouterConfig::new("router-1", "127.0.0.1:0");
        let node = RouterNode::new(config);
        assert!(node.subscribe_tap().is_none());
    }

    #[tokio::test]
    async fn tap_enabled_with_capacity() {
        let node = RouterNode::new(make_config("router-1"));
        assert!(node.subscribe_tap().is_some());
    }

    // ── Hello addresses → route table + upstream propagation ──────────

    /// Helper: set up the on_peer_connect callback exactly as start() does,
    /// without starting the actual listener.
    async fn setup_peer_callbacks(node: &Arc<RouterNode>) {
        node.connections
            .set_on_peer_connect(Arc::new({
                let node = node.clone();
                move |peer_id, _role, addresses| {
                    let node = node.clone();
                    tokio::spawn(async move {
                        for address in addresses {
                            node.route_table
                                .write()
                                .await
                                .upsert(address.clone(), &peer_id, 0);
                            node.propagate_downstream_route_to_upstream(&peer_id, address, 0)
                                .await;
                        }
                    });
                }
            }))
            .await;

        node.connections
            .set_on_peer_disconnect(Arc::new({
                let node = node.clone();
                move |peer_id| {
                    let node = node.clone();
                    tokio::spawn(async move {
                        node.route_table.write().await.remove_neighbor(&peer_id);
                    });
                }
            }))
            .await;
    }

    #[tokio::test]
    async fn hello_addresses_learned_into_route_table() {
        let node = Arc::new(RouterNode::new(make_config("router-1")));
        setup_peer_callbacks(&node).await;

        // Simulate a peer connecting with Hello addresses
        let callback = node.connections.on_peer_connect.lock().await;
        let cb = callback.as_ref().expect("callback should be set");
        cb(
            "control-ep".into(),
            PeerRole::Endpoint,
            vec![
                SessionAddress::new("domain-a", Some("surface-runtime-control".into()), Some("surface-control".into())),
            ],
        );

        // Give spawned task time to complete
        tokio::task::yield_now().await;

        // Route table should have the address
        let rt = node.route_table.read().await;
        let decision = rt.decide(&SessionEnvelope::new(
            SessionAddress::new("router-1", None, None),
            SessionAddress::new("domain-a", Some("surface-runtime-control".into()), Some("surface-control".into())),
            "test",
            serde_json::Value::Null,
        ));
        assert!(
            matches!(decision.next_hop, gv_core::NextHop::Neighbor(ref n) if n == "control-ep"),
            "route table should route domain-a/surface-runtime-control/surface-control via control-ep"
        );
    }

    #[tokio::test]
    async fn hello_addresses_propagated_to_upstream() {
        let node = Arc::new(RouterNode::new(make_config("child-router")));
        setup_peer_callbacks(&node).await;

        // Set up upstream
        let (tx, mut rx) = mpsc::unbounded_channel();
        *node.connections.upstream.write().await = Some(UpstreamHandle::new("root-router", tx));

        // Simulate endpoint connecting with Hello addresses
        let callback = node.connections.on_peer_connect.lock().await;
        let cb = callback.as_ref().expect("callback should be set");
        cb(
            "control-ep".into(),
            PeerRole::Endpoint,
            vec![
                SessionAddress::new("domain-a", Some("rt-1".into()), Some("ses-1".into())),
            ],
        );

        // Give spawned task time to complete
        tokio::task::yield_now().await;

        // Upstream should receive the re-announced route
        let msg = rx.try_recv().expect("upstream should receive re-announced route");
        match msg {
            LinkMessage::Announce { address, distance } => {
                assert_eq!(address.domain, "domain-a");
                assert_eq!(address.runtime.as_deref(), Some("rt-1"));
                assert_eq!(address.session.as_deref(), Some("ses-1"));
                assert_eq!(distance, 1);
            }
            other => panic!("expected Announce, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn hello_addresses_not_propagated_when_from_upstream() {
        // When upstream's Hello addresses are learned (via dispatch_message Announce),
        // propagate_downstream_route_to_upstream should NOT reflect them back.
        // This is already tested for Announce messages, but let's verify the
        // on_peer_connect callback doesn't bypass this check.
        let node = Arc::new(RouterNode::new(make_config("child-router")));
        setup_peer_callbacks(&node).await;

        let (tx, mut rx) = mpsc::unbounded_channel();
        *node.connections.upstream.write().await = Some(UpstreamHandle::new("root-router", tx));

        // Directly learn a route from "root-router" (simulating upstream Hello addresses)
        // via the Announce message path (which is what upstream.rs now uses)
        node.handle_message(
            "root-router",
            LinkMessage::Announce {
                address: SessionAddress::new("upstream-domain", None, None),
                distance: 1,
            },
        )
        .await
        .unwrap();

        // Should NOT reflect back to upstream
        assert!(rx.try_recv().is_err(), "upstream route should not be reflected back");
    }

    #[tokio::test]
    async fn peer_disconnect_removes_routes_from_table() {
        let node = Arc::new(RouterNode::new(make_config("router-1")));
        setup_peer_callbacks(&node).await;

        // Simulate peer connecting with Hello address
        let callback = node.connections.on_peer_connect.lock().await;
        let cb = callback.as_ref().expect("callback should be set");
        cb(
            "control-ep".into(),
            PeerRole::Endpoint,
            vec![SessionAddress::new("domain-a", None, None)],
        );
        tokio::task::yield_now().await;

        // Verify route exists
        {
            let rt = node.route_table.read().await;
            let decision = rt.decide(&SessionEnvelope::new(
                SessionAddress::new("router-1", None, None),
                SessionAddress::new("domain-a", None, None),
                "test",
                serde_json::Value::Null,
            ));
            assert!(matches!(decision.next_hop, gv_core::NextHop::Neighbor(ref n) if n == "control-ep"));
        }

        // Simulate disconnect
        let callback = node.connections.on_peer_disconnect.lock().await;
        let cb = callback.as_ref().expect("callback should be set");
        cb("control-ep".into());
        tokio::task::yield_now().await;

        // Route should be removed
        {
            let rt = node.route_table.read().await;
            let decision = rt.decide(&SessionEnvelope::new(
                SessionAddress::new("router-1", None, None),
                SessionAddress::new("domain-a", None, None),
                "test",
                serde_json::Value::Null,
            ));
            assert!(
                matches!(decision.next_hop, gv_core::NextHop::Drop(_)),
                "route should be removed after peer disconnect"
            );
        }
    }

    /// Tests the complete scenario: endpoint with Hello addresses connects
    /// to child router, which propagates to root. Then a response targeting
    /// the endpoint's address can be routed from root → child → endpoint
    /// without any extra Announce.
    #[tokio::test]
    async fn response_routes_to_endpoint_behind_child_via_hello_addresses() {
        let root = Arc::new(RouterNode::new(make_config("root")));
        let child = Arc::new(RouterNode::new(make_config("child")));
        setup_peer_callbacks(&child).await;

        // Wire child → root upstream
        let (root_from_child_tx, mut root_from_child_rx) = mpsc::unbounded_channel();
        let upstream_handle = UpstreamHandle::new("root", root_from_child_tx);
        *child.connections.upstream.write().await = Some(upstream_handle);

        // Wire root → child as downstream peer
        let (child_peer_tx, mut child_rx) = mpsc::unbounded_channel();
        let child_peer = PeerHandle::new("child", PeerRole::Router, child_peer_tx);
        root.connections.peers.write().await.insert("child".into(), child_peer);

        // Control endpoint connects to child router with Hello addresses
        let control_address = SessionAddress::new(
            "domain-a",
            Some("surface-runtime-control".into()),
            Some("surface-control".into()),
        );

        // Simulate the on_peer_connect callback firing
        let callback = child.connections.on_peer_connect.lock().await;
        let cb = callback.as_ref().expect("callback should be set");
        cb("control-ep".into(), PeerRole::Endpoint, vec![control_address.clone()]);
        drop(callback);

        // Also register control-ep as a peer on child (normally done by handle_incoming_link)
        let (control_ep_tx, mut control_ep_rx) = mpsc::unbounded_channel();
        let control_ep_handle = PeerHandle::new("control-ep", PeerRole::Endpoint, control_ep_tx);
        child.connections.peers.write().await.insert("control-ep".into(), control_ep_handle);
        child.connections.peer_routes.write().await.insert("control-ep".into(), vec![control_address.clone()]);

        // Give spawned tasks time to complete
        tokio::task::yield_now().await;

        // Child should have the route locally
        {
            let rt = child.route_table.read().await;
            let decision = rt.decide(&SessionEnvelope::new(
                SessionAddress::new("child", None, None),
                control_address.clone(),
                "test",
                serde_json::Value::Null,
            ));
            assert!(
                matches!(decision.next_hop, gv_core::NextHop::Neighbor(ref n) if n == "control-ep"),
                "child should route control_address to control-ep"
            );
        }

        // The propagation to upstream should have sent an Announce
        let announce_msg = root_from_child_rx.try_recv().expect("child should re-announce to root");
        match &announce_msg {
            LinkMessage::Announce { address, distance } => {
                assert_eq!(*address, control_address);
                assert_eq!(*distance, 1);
            }
            other => panic!("expected Announce, got: {:?}", other),
        }

        // Root learns the route from child's Announce
        root.handle_message("child", announce_msg).await.unwrap();

        // Root should now route domain-a → child
        {
            let rt = root.route_table.read().await;
            let decision = rt.decide(&SessionEnvelope::new(
                SessionAddress::new("root", None, None),
                control_address.clone(),
                "test",
                serde_json::Value::Null,
            ));
            assert!(
                matches!(decision.next_hop, gv_core::NextHop::Neighbor(ref n) if n == "child"),
                "root should route domain-a via child"
            );
        }

        // Now simulate a ReadResponse from west targeting the control endpoint
        let response = osgp::ReadResponse::ok_for_request(
            &SessionAddress::new("west", None, None),
            &osgp::ReadRequest::new(
                control_address.clone(),
                SessionAddress::new("west", None, None),
                osgp::ReadOperation::RuntimeWorkspaceViewSnapshot {
                    runtime_id: "rt-west".into(),
                    workspace: None,
                },
            ),
            serde_json::json!({"workspaces": []}),
        );

        // Set up message handler on root
        let node = root.clone();
        root.connections
            .set_message_handler(Arc::new(move |from_id: String, message: LinkMessage| {
                let node = node.clone();
                tokio::spawn(async move {
                    let _ = node.handle_message(&from_id, message).await;
                });
                true
            }))
            .await;

        root.handle_message("west-ep", osgp::LinkMessage::ReadResponse(response))
            .await
            .unwrap();

        // Root should forward the response to child
        let msg_to_child = child_rx.try_recv().expect("root should forward response to child");
        match &msg_to_child {
            osgp::LinkMessage::ReadResponse(resp) => {
                assert_eq!(resp.target, control_address);
            }
            other => panic!("expected ReadResponse, got: {:?}", other),
        }

        // Set up message handler on child
        let node = child.clone();
        child.connections
            .set_message_handler(Arc::new(move |from_id: String, message: LinkMessage| {
                let node = node.clone();
                tokio::spawn(async move {
                    let _ = node.handle_message(&from_id, message).await;
                });
                true
            }))
            .await;

        // Child routes response to control-ep
        child.handle_message("root", msg_to_child).await.unwrap();

        // Control endpoint should receive the response
        let msg = control_ep_rx.try_recv().expect("control-ep should receive response");
        match msg {
            osgp::LinkMessage::ReadResponse(resp) => {
                assert!(resp.is_ok());
                assert_eq!(resp.target, control_address);
            }
            other => panic!("expected ReadResponse at control-ep, got: {:?}", other),
        }
    }
}
