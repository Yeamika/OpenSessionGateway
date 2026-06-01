//! Router node — main runtime structure.
//!
//! Holds the route table, connection manager, and optional tap broadcaster.
//! Designed for tree topology (0–1 upstream, N downstream).

use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Result;
use gv_core::{PermissionOp, PermissionQueue, RouteTable};
use osgp::{LinkMessage, SessionAddress};
use tokio::sync::{broadcast as tokio_broadcast, RwLock};
use tracing::{debug, info, warn};

use crate::admin::AdminHandler;
use crate::config::{ListenerBackend, RouterConfig};
use crate::connection::{ConnectionManager, ListenerConfig, UpstreamConfig};
use crate::envelope_forward;
use crate::read_forward;
use crate::tap::TapEvent;

/// A GlassVein routing node.
pub struct RouterNode {
    pub(crate) config: RouterConfig,
    /// Route table for forwarding decisions.
    pub route_table: Arc<RwLock<RouteTable>>,
    /// Connection manager for all WebSocket connections
    pub connections: Arc<ConnectionManager>,
    /// Per-peer announced addresses (for removal on disconnect).
    pub(crate) peer_routes: Arc<RwLock<HashMap<String, Vec<SessionAddress>>>>,
    /// Optional tap broadcaster
    pub(crate) tap_tx: Option<tokio_broadcast::Sender<TapEvent>>,
    /// Permission queue for policy enforcement.
    pub permission_queue: Arc<RwLock<PermissionQueue>>,
    /// Admin handler for admin request processing.
    pub admin_handler: AdminHandler,
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

        let route_table = Arc::new(RwLock::new(RouteTable::default()));
        let rule_table = Arc::new(RwLock::new(gv_core::RuleTable::default()));
        let permission_queue = Arc::new(RwLock::new(PermissionQueue::default()));
        let admin_handler = AdminHandler::new(
            config.node_id.clone(),
            route_table.clone(),
            rule_table,
        );

        Self {
            config,
            route_table,
            connections,
            peer_routes,
            tap_tx,
            permission_queue,
            admin_handler,
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

    /// Check if a peer has permission for an operation.
    ///
    /// Returns `true` if the peer has an active grant. If not, enqueues
    /// a pending permission request and returns `false`.
    pub async fn check_permission(&self, peer_id: &str, op: PermissionOp) -> bool {
        let mut perms = self.permission_queue.write().await;
        if perms.has_grant(peer_id, &op) {
            return true;
        }
        // Enqueue pending request (default deny policy)
        let req_id = perms.enqueue(peer_id.to_string(), op.clone());
        info!(
            router = %self.config.node_id,
            peer = %peer_id,
            op = %op.as_str(),
            request_id = %req_id,
            "permission request enqueued (no active grant)"
        );
        false
    }

    // ── Message processing ──────────────────────────────────────────

    /// Process an incoming link message from a neighbor.
    pub async fn handle_message(&self, from_neighbor: &str, message: LinkMessage) -> Result<()> {
        match message {
            LinkMessage::Announce { address, distance } => {
                // Permission gate: announce.route
                if !self.check_permission(from_neighbor, PermissionOp::AnnounceRoute).await {
                    warn!(
                        router = %self.config.node_id,
                        peer = %from_neighbor,
                        address = %crate::format_address(&address),
                        "announce rejected: no permission grant"
                    );
                    return Ok(());
                }
                self.learn_route(address.clone(), from_neighbor, distance)
                    .await;
                self.propagate_downstream_route_to_upstream(from_neighbor, address, distance)
                    .await;
            }
            LinkMessage::Envelope(envelope) => {
                // Check for admin request envelope (internal exception)
                if envelope.kind == "admin.request" {
                    self.handle_admin_envelope(from_neighbor, envelope).await;
                    return Ok(());
                }
                // Validate subtype against canonical registry.
                // Rejects dynamic/non-business subtypes like im_gateway.*, timer.fired, etc.
                if let Err(e) = osgp::envelope::validate_envelope_subtype(
                    &envelope.link_type,
                    &envelope.subtype,
                ) {
                    warn!(
                        router = %self.config.node_id,
                        peer = %from_neighbor,
                        envelope_id = %envelope.id,
                        link_type = %envelope.link_type,
                        subtype = %envelope.subtype,
                        error = %e,
                        "envelope rejected: non-canonical subtype"
                    );
                    return Ok(());
                }
                envelope_forward::forward_envelope(self, from_neighbor, envelope).await;
            }
            LinkMessage::TypedEnvelope(envelope) => {
                // Validate subtype against canonical registry.
                if let Err(e) = osgp::subtype_registry::validate_canonical(
                    envelope.link_type.as_wire(),
                    &envelope.subtype,
                ) {
                    warn!(
                        router = %self.config.node_id,
                        peer = %from_neighbor,
                        message_id = %envelope.message_id,
                        link_type = ?envelope.link_type,
                        subtype = %envelope.subtype,
                        error = %e,
                        "typed envelope rejected: non-canonical subtype"
                    );
                    return Ok(());
                }
                envelope_forward::forward_typed_envelope(self, from_neighbor, envelope).await;
            }
            LinkMessage::ReadRequest(request) => {
                // Validate subtype against canonical registry.
                if let Err(e) = osgp::subtype_registry::validate_canonical(
                    &request.link_type,
                    &request.subtype,
                ) {
                    warn!(
                        router = %self.config.node_id,
                        peer = %from_neighbor,
                        request_id = %request.request_id,
                        link_type = %request.link_type,
                        subtype = %request.subtype,
                        error = %e,
                        "read request rejected: non-canonical subtype"
                    );
                    return Ok(());
                }
                // Permission gate: read.runtime_session_messages
                if !self
                    .check_permission(from_neighbor, PermissionOp::ReadRuntimeSessionMessages)
                    .await
                {
                    warn!(
                        router = %self.config.node_id,
                        peer = %from_neighbor,
                        "read request rejected: no permission grant"
                    );
                    return Ok(());
                }
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
                // Validate subtype against canonical registry (response mirrors request).
                if let Err(e) = osgp::subtype_registry::validate_canonical(
                    &response.link_type,
                    &response.subtype,
                ) {
                    warn!(
                        router = %self.config.node_id,
                        peer = %from_neighbor,
                        request_id = %response.request_id,
                        link_type = %response.link_type,
                        subtype = %response.subtype,
                        error = %e,
                        "read response rejected: non-canonical subtype"
                    );
                    return Ok(());
                }
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

    /// Handle an admin request envelope. Parses the payload as `AdminRequest`,
    /// calls the admin handler, and sends the response back to the source.
    async fn handle_admin_envelope(&self, from_neighbor: &str, envelope: osgp::SessionEnvelope) {
        // Permission gate: admin.routes.read (basic admin access)
        if !self
            .check_permission(from_neighbor, PermissionOp::AdminRoutesRead)
            .await
        {
            warn!(
                router = %self.config.node_id,
                peer = %from_neighbor,
                "admin request rejected: no permission grant"
            );
            return;
        }

        // Parse AdminRequest from payload
        let request: crate::admin::AdminRequest = match serde_json::from_value(envelope.payload.clone()) {
            Ok(r) => r,
            Err(e) => {
                warn!(
                    router = %self.config.node_id,
                    peer = %from_neighbor,
                    error = %e,
                    "invalid admin request payload"
                );
                return;
            }
        };

        info!(
            router = %self.config.node_id,
            peer = %from_neighbor,
            "admin request received"
        );

        // Execute via admin handler
        let response = self.admin_handler.handle(request).await;

        // Build response envelope
        let response_envelope = osgp::SessionEnvelope {
            id: uuid::Uuid::new_v4(),
            source: envelope.target.clone(),
            target: envelope.source.clone(),
            kind: "admin.response".to_string(),
            link_type: "control".to_string(),
            subtype: "admin_response".to_string(),
            payload: serde_json::to_value(&response).unwrap_or_default(),
            ttl: 32,
            route_hops: Vec::new(),
            origin_surface: None,
        };

        // Send response back to source
        let peers = self.connections.peers.read().await;
        if let Some(peer) = peers.get(from_neighbor) {
            let _ = peer.send(LinkMessage::Envelope(response_envelope));
        }
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
mod tests;
