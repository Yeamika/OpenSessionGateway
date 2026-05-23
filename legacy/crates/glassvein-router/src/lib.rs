mod observe;
mod transport;

pub use observe::OsgMitmConfig;
#[allow(deprecated)]
pub use observe::OSG_SESSION_UPDATES_PATH;
pub use observe::{
    append_query_to_upstream, build_observation, classify_path, run_observe, run_osg_mitm,
    Direction, FrameOpcode, GlassVeinObservation, ObserveConfig, PathClass, GLASSVEIN_OBSERVE_PATH,
};
pub use transport::{
    ChannelPeerSink, ChannelUpstreamSink, LegacyPeerSink, LegacyUpstreamSink, PeerSink,
    TransportError, UpstreamSink,
};

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};

use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use glassvein_core::{NextHop, RouteTable};
use glassvein_protocol::{NodeRole, RouteAddress, RouteAnnouncement, RouteEnvelope, WireMessage};
use serde::Serialize;
use serde_json::json;
use tokio::{
    net::TcpListener,
    sync::{broadcast, mpsc, oneshot, RwLock},
    time::{sleep, Duration},
};
use tokio_tungstenite::{accept_async, connect_async, tungstenite::Message};
use tracing::{debug, info, warn};

type Tx = mpsc::UnboundedSender<WireMessage>;

// ── Tap events ──────────────────────────────────────────────────────

/// Observation event emitted when the router processes an envelope.
///
/// Surface/Panel roles can subscribe to these events via [`run_router_with_tap`].
/// Regular Client roles do not receive tap events — they only see messages
/// routed directly to them.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TapEvent {
    /// Envelope was forwarded to a downstream peer.
    ForwardPeer {
        envelope: RouteEnvelope,
        peer_id: String,
        distance: u16,
    },
    /// Envelope was forwarded to an upstream router.
    ForwardUpstream {
        envelope: RouteEnvelope,
        upstream_id: String,
        distance: u16,
    },
    /// Envelope was forwarded via deterministic fallback to upstream.
    ForwardFallback {
        envelope: RouteEnvelope,
        upstream_id: String,
    },
    /// Envelope was dropped: TTL exhausted.
    DropTtl {
        envelope: RouteEnvelope,
    },
    /// Envelope was dropped: no route found, no fallback available.
    DropNoRoute {
        envelope: RouteEnvelope,
    },
    /// An error reply was sent back to the source because the target was unreachable.
    ErrorReply {
        original_target: RouteAddress,
        error_kind: String,
        reply_envelope: RouteEnvelope,
    },
}

// ── Configuration ───────────────────────────────────────────────────

#[derive(Clone, Debug)]
pub struct RouterConfig {
    pub node_id: String,
    pub bind_addr: String,
    pub upstream_urls: Vec<String>,
    pub announce_routes: Vec<RouteAddress>,
    /// Capacity of the tap event broadcast channel.
    /// If `None`, tap is disabled (no events emitted).
    pub tap_capacity: Option<usize>,
}

impl RouterConfig {
    /// Create a config with tap disabled (backward compatible).
    pub fn new(node_id: String, bind_addr: String) -> Self {
        Self {
            node_id,
            bind_addr,
            upstream_urls: Vec::new(),
            announce_routes: Vec::new(),
            tap_capacity: None,
        }
    }
}

#[derive(Clone, Debug)]
pub struct DemoClientConfig {
    pub node_id: String,
    pub role: NodeRole,
    pub router_url: String,
    pub route: RouteAddress,
    pub auto_reply: bool,
    pub initial_target: Option<RouteAddress>,
}

#[derive(Clone)]
struct RouterState {
    node_id: String,
    route_table: Arc<RwLock<RouteTable>>,
    peers: Arc<RwLock<HashMap<String, Tx>>>,
    peer_roles: Arc<RwLock<HashMap<String, NodeRole>>>,
    upstreams: Arc<RwLock<HashMap<String, Tx>>>,
    metrics: Arc<RouterMetrics>,
    tap_tx: Option<broadcast::Sender<TapEvent>>,
}

impl RouterState {
    fn new(node_id: String, tap_tx: Option<broadcast::Sender<TapEvent>>) -> Self {
        Self {
            node_id,
            route_table: Arc::new(RwLock::new(RouteTable::default())),
            peers: Arc::new(RwLock::new(HashMap::new())),
            peer_roles: Arc::new(RwLock::new(HashMap::new())),
            upstreams: Arc::new(RwLock::new(HashMap::new())),
            metrics: Arc::new(RouterMetrics::default()),
            tap_tx,
        }
    }

    /// Emit a tap event. Silently ignored if tap is disabled or no receivers.
    fn emit_tap(&self, event: TapEvent) {
        if let Some(tx) = &self.tap_tx {
            let _ = tx.send(event);
        }
    }
}

#[derive(Default)]
struct RouterMetrics {
    forwarded_total: AtomicU64,
    forwarded_bytes_total: AtomicU64,
    dropped_total: AtomicU64,
}

impl RouterMetrics {
    fn record_forward(&self, envelope: &RouteEnvelope) {
        let bytes = serde_json::to_vec(envelope)
            .map(|bytes| bytes.len() as u64)
            .unwrap_or(0);
        self.forwarded_total.fetch_add(1, Ordering::Relaxed);
        self.forwarded_bytes_total
            .fetch_add(bytes, Ordering::Relaxed);
    }

    fn record_drop(&self) {
        self.dropped_total.fetch_add(1, Ordering::Relaxed);
    }
}

pub async fn run_router(config: RouterConfig) -> Result<()> {
    let state = RouterState::new(config.node_id.clone(), None);

    tokio::spawn(report_router_metrics(state.clone()));

    for upstream_url in config.upstream_urls.clone() {
        let upstream_state = state.clone();
        let announce_routes = config.announce_routes.clone();
        tokio::spawn(async move {
            if let Err(error) =
                connect_upstream(upstream_state, upstream_url, announce_routes).await
            {
                warn!(%error, "upstream connection stopped");
            }
        });
    }

    let listener = TcpListener::bind(&config.bind_addr)
        .await
        .with_context(|| format!("bind router {} at {}", config.node_id, config.bind_addr))?;
    info!(node_id = %config.node_id, addr = %config.bind_addr, "router listening");

    loop {
        let (stream, addr) = listener.accept().await?;
        let peer_state = state.clone();
        tokio::spawn(async move {
            match accept_async(stream).await {
                Ok(ws) => {
                    info!(router = %peer_state.node_id, %addr, "downstream connected");
                    if let Err(error) = handle_connection(peer_state, ws, false, None, None).await {
                        warn!(%error, %addr, "downstream connection failed");
                    }
                }
                Err(error) => warn!(%error, %addr, "websocket accept failed"),
            }
        });
    }
}

/// Run a router with tap event broadcasting enabled.
///
/// Returns a [`broadcast::Receiver<TapEvent>`] that Surface/Panel roles can
/// use to observe all forwarding activity. Regular Client roles should not
/// subscribe — they only see messages routed directly to them.
///
/// The receiver is a broadcast channel: multiple subscribers can tap
/// independently. Slow receivers will miss events (lagged).
pub async fn run_router_with_tap(
    config: RouterConfig,
) -> Result<broadcast::Receiver<TapEvent>> {
    let capacity = config.tap_capacity.unwrap_or(256);
    let (tap_tx, tap_rx) = broadcast::channel(capacity);
    let state = RouterState::new(config.node_id.clone(), Some(tap_tx));

    tokio::spawn(report_router_metrics(state.clone()));

    for upstream_url in config.upstream_urls.clone() {
        let upstream_state = state.clone();
        let announce_routes = config.announce_routes.clone();
        tokio::spawn(async move {
            if let Err(error) =
                connect_upstream(upstream_state, upstream_url, announce_routes).await
            {
                warn!(%error, "upstream connection stopped");
            }
        });
    }

    let listener = TcpListener::bind(&config.bind_addr)
        .await
        .with_context(|| format!("bind router {} at {}", config.node_id, config.bind_addr))?;
    info!(node_id = %config.node_id, addr = %config.bind_addr, "router listening (tap enabled)");

    tokio::spawn(async move {
        loop {
            let (stream, addr) = match listener.accept().await {
                Ok(pair) => pair,
                Err(error) => {
                    warn!(%error, "accept failed");
                    continue;
                }
            };
            let peer_state = state.clone();
            tokio::spawn(async move {
                match accept_async(stream).await {
                    Ok(ws) => {
                        info!(router = %peer_state.node_id, %addr, "downstream connected");
                        if let Err(error) = handle_connection(peer_state, ws, false, None, None).await {
                            warn!(%error, %addr, "downstream connection failed");
                        }
                    }
                    Err(error) => warn!(%error, %addr, "websocket accept failed"),
                }
            });
        }
    });

    Ok(tap_rx)
}

async fn report_router_metrics(state: RouterState) {
    let mut last_forwarded = 0;
    let mut last_bytes = 0;

    loop {
        sleep(Duration::from_secs(1)).await;

        let forwarded = state.metrics.forwarded_total.load(Ordering::Relaxed);
        let bytes = state.metrics.forwarded_bytes_total.load(Ordering::Relaxed);
        let dropped = state.metrics.dropped_total.load(Ordering::Relaxed);
        let peers = state.peers.read().await.len();
        let upstreams = state.upstreams.read().await.len();
        let route_entries = state.route_table.read().await.snapshot().len();

        let forwarded_per_sec = forwarded.saturating_sub(last_forwarded);
        let bytes_per_sec = bytes.saturating_sub(last_bytes);
        last_forwarded = forwarded;
        last_bytes = bytes;

        info!(
            router = %state.node_id,
            forwarded_per_sec,
            bytes_per_sec,
            forwarded_total = forwarded,
            forwarded_bytes_total = bytes,
            dropped_total = dropped,
            peers,
            upstreams,
            route_entries,
            "router forwarding speed"
        );
    }
}

async fn connect_upstream(
    state: RouterState,
    upstream_url: String,
    announce_routes: Vec<RouteAddress>,
) -> Result<()> {
    // Minimal retry loop for demo startup ordering.
    loop {
        match connect_async(&upstream_url).await {
            Ok((ws, _)) => {
                info!(router = %state.node_id, %upstream_url, "connected upstream");
                let hello = WireMessage::Hello {
                    node_id: state.node_id.clone(),
                    role: NodeRole::Router,
                    routes: announce_routes
                        .iter()
                        .cloned()
                        .map(RouteAnnouncement::local)
                        .collect(),
                };
                return handle_connection(state, ws, true, Some(hello), Some(upstream_url)).await;
            }
            Err(error) => {
                warn!(router = %state.node_id, %upstream_url, %error, "upstream connect failed; retrying");
                sleep(Duration::from_millis(150)).await;
            }
        }
    }
}

async fn handle_connection<S>(
    state: RouterState,
    ws: tokio_tungstenite::WebSocketStream<S>,
    is_upstream: bool,
    initial: Option<WireMessage>,
    upstream_key: Option<String>,
) -> Result<()>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let (mut writer, mut reader) = ws.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<WireMessage>();

    if is_upstream {
        let key = upstream_key
            .clone()
            .unwrap_or_else(|| "upstream:unknown".to_string());
        state.upstreams.write().await.insert(key, tx.clone());
    }

    if let Some(message) = initial {
        tx.send(message).ok();
    }

    let writer_task = tokio::spawn(async move {
        while let Some(message) = rx.recv().await {
            let text = match serde_json::to_string(&message) {
                Ok(text) => text,
                Err(error) => {
                    warn!(%error, "failed to serialize wire message");
                    continue;
                }
            };
            if writer.send(Message::Text(text.into())).await.is_err() {
                break;
            }
        }
    });

    let mut peer_id: Option<String> = None;

    while let Some(message) = reader.next().await {
        let message = message?;
        if !message.is_text() {
            continue;
        }
        let wire: WireMessage = serde_json::from_str(message.to_text()?)?;
        match wire {
            WireMessage::Hello {
                node_id,
                role,
                routes,
            } => {
                info!(router = %state.node_id, peer = %node_id, ?role, route_count = routes.len(), is_upstream, "hello received");
                let hop = if is_upstream {
                    upstream_key
                        .as_ref()
                        .map(|key| NextHop::Upstream(key.clone()))
                } else {
                    peer_id = Some(node_id.clone());
                    state
                        .peers
                        .write()
                        .await
                        .insert(node_id.clone(), tx.clone());
                    state
                        .peer_roles
                        .write()
                        .await
                        .insert(node_id.clone(), role.clone());
                    Some(NextHop::Peer(node_id.clone()))
                };

                if let Some(hop) = hop {
                    let changed = apply_route_announcements(&state, &routes, hop).await;
                    if !is_upstream && matches!(role, NodeRole::Router) {
                        announce_routes_to_peer(&state, &node_id).await;
                    }
                    if changed {
                        announce_routes_to_neighbors(&state).await;
                    }
                }
            }
            WireMessage::RouteUpdate { node_id, routes } => {
                info!(router = %state.node_id, peer = %node_id, route_count = routes.len(), is_upstream, "route update received");
                let hop = if is_upstream {
                    upstream_key
                        .as_ref()
                        .map(|key| NextHop::Upstream(key.clone()))
                } else {
                    Some(NextHop::Peer(node_id.clone()))
                };

                if let Some(hop) = hop {
                    let changed = apply_route_announcements(&state, &routes, hop).await;
                    if changed {
                        announce_routes_to_neighbors(&state).await;
                    }
                }
            }
            WireMessage::Envelope { envelope } => {
                route_envelope(
                    &state,
                    *envelope,
                    peer_id.as_deref(),
                    is_upstream.then_some(upstream_key.as_deref()).flatten(),
                )
                .await;
            }
        }
    }

    if is_upstream {
        if let Some(key) = upstream_key {
            state.upstreams.write().await.remove(&key);
            if state.route_table.write().await.remove_upstream(&key) {
                announce_routes_to_neighbors(&state).await;
            }
        }
    }
    if let Some(peer_id) = peer_id {
        state.peers.write().await.remove(&peer_id);
        state.peer_roles.write().await.remove(&peer_id);
        if state.route_table.write().await.remove_peer(&peer_id) {
            announce_routes_to_neighbors(&state).await;
        }
        info!(router = %state.node_id, peer = %peer_id, "peer removed");
    }
    writer_task.abort();
    Ok(())
}

async fn apply_route_announcements(
    state: &RouterState,
    routes: &[RouteAnnouncement],
    hop: NextHop,
) -> bool {
    let mut table = state.route_table.write().await;
    let mut changed = false;
    for route in routes {
        changed |= table.upsert_announcement(route, hop.clone());
    }
    debug!(router = %state.node_id, routes = ?table.snapshot(), "route table updated");
    changed
}

async fn announce_routes_to_neighbors(state: &RouterState) {
    announce_routes_to_upstreams(state).await;

    let router_peer_ids = {
        let peer_roles = state.peer_roles.read().await;
        peer_roles
            .iter()
            .filter(|&(_, role)| matches!(role, NodeRole::Router))
            .map(|(peer_id, _)| peer_id.clone())
            .collect::<Vec<_>>()
    };

    for peer_id in router_peer_ids {
        announce_routes_to_peer(state, &peer_id).await;
    }
}

async fn announce_routes_to_upstreams(state: &RouterState) {
    let upstream_ids = state
        .upstreams
        .read()
        .await
        .keys()
        .cloned()
        .collect::<Vec<_>>();

    for upstream_id in upstream_ids {
        announce_routes_to_upstream(state, &upstream_id).await;
    }
}

async fn announce_routes_to_upstream(state: &RouterState, upstream_id: &str) {
    let avoid = NextHop::Upstream(upstream_id.to_string());
    let routes = state
        .route_table
        .read()
        .await
        .export_announcements_excluding(Some(&avoid));
    if routes.is_empty() {
        return;
    }

    let tx = state.upstreams.read().await.get(upstream_id).cloned();
    if let Some(tx) = tx {
        info!(router = %state.node_id, %upstream_id, route_count = routes.len(), "announce routes upstream");
        tx.send(WireMessage::RouteUpdate {
            node_id: state.node_id.clone(),
            routes,
        })
        .ok();
    }
}

async fn announce_routes_to_peer(state: &RouterState, peer_id: &str) {
    let avoid = NextHop::Peer(peer_id.to_string());
    let routes = state
        .route_table
        .read()
        .await
        .export_announcements_excluding(Some(&avoid));
    if routes.is_empty() {
        return;
    }

    let tx = state.peers.read().await.get(peer_id).cloned();
    if let Some(tx) = tx {
        info!(router = %state.node_id, %peer_id, route_count = routes.len(), "announce routes peer");
        tx.send(WireMessage::RouteUpdate {
            node_id: state.node_id.clone(),
            routes,
        })
        .ok();
    }
}

async fn route_envelope(
    state: &RouterState,
    envelope: RouteEnvelope,
    from_peer: Option<&str>,
    from_upstream: Option<&str>,
) {
    // Clone envelope for tap events before consuming it
    let envelope_for_tap = envelope.clone();
    
    let Some(envelope) = envelope.hop(state.node_id.clone()) else {
        state.metrics.record_drop();
        state.emit_tap(TapEvent::DropTtl {
            envelope: envelope_for_tap,
        });
        warn!(router = %state.node_id, "drop envelope: ttl exhausted");
        return;
    };

    let avoid = from_peer
        .map(|peer_id| NextHop::Peer(peer_id.to_string()))
        .or_else(|| from_upstream.map(|upstream_id| NextHop::Upstream(upstream_id.to_string())));

    if let Some(entry) = state
        .route_table
        .read()
        .await
        .resolve(&envelope.target, avoid.as_ref())
    {
        match entry.hop {
            NextHop::Peer(peer_id) => {
                let peers = state.peers.read().await;
                if let Some(tx) = peers.get(&peer_id) {
                    info!(router = %state.node_id, %peer_id, distance = entry.distance, target = %envelope.target.key(), kind = %envelope.kind, "forward peer shortest path");
                    state.metrics.record_forward(&envelope);
                    state.emit_tap(TapEvent::ForwardPeer {
                        envelope: envelope.clone(),
                        peer_id: peer_id.clone(),
                        distance: entry.distance,
                    });
                    tx.send(WireMessage::Envelope {
                        envelope: Box::new(envelope),
                    })
                    .ok();
                    return;
                }
            }
            NextHop::Upstream(upstream_id) => {
                let upstreams = state.upstreams.read().await;
                if let Some(tx) = upstreams.get(&upstream_id) {
                    info!(router = %state.node_id, %upstream_id, distance = entry.distance, target = %envelope.target.key(), kind = %envelope.kind, "forward upstream shortest path");
                    state.metrics.record_forward(&envelope);
                    state.emit_tap(TapEvent::ForwardUpstream {
                        envelope: envelope.clone(),
                        upstream_id: upstream_id.clone(),
                        distance: entry.distance,
                    });
                    tx.send(WireMessage::Envelope {
                        envelope: Box::new(envelope),
                    })
                    .ok();
                    return;
                }
            }
        }
    }

    if from_upstream.is_none() {
        // Deterministic fallback: pick the lexicographically smallest upstream_id.
        let chosen = {
            let upstreams = state.upstreams.read().await;
            let mut keys: Vec<&String> = upstreams.keys().collect();
            keys.sort();
            keys.first()
                .and_then(|k| upstreams.get(*k).cloned().map(|tx| ((*k).clone(), tx)))
        };
        if let Some((upstream_id, tx)) = chosen {
            info!(router = %state.node_id, %upstream_id, target = %envelope.target.key(), kind = %envelope.kind, "forward upstream fallback");
            state.metrics.record_forward(&envelope);
            state.emit_tap(TapEvent::ForwardFallback {
                envelope: envelope.clone(),
                upstream_id: upstream_id.clone(),
            });
            tx.send(WireMessage::Envelope {
                envelope: Box::new(envelope),
            })
            .ok();
            return;
        }
    }

    // No route found and no fallback — drop and emit error reply to source.
    state.metrics.record_drop();
    state.emit_tap(TapEvent::DropNoRoute {
        envelope: envelope.clone(),
    });
    warn!(router = %state.node_id, target = %envelope.target.key(), kind = %envelope.kind, "drop envelope: no route");

    // Send error reply back to source if we know how to reach it.
    send_error_reply(state, &envelope, "error.no_route").await;
}

/// Send an error reply envelope back to the source of the original envelope.
///
/// This allows the sender to know that delivery failed. The error envelope
/// uses kind `"error.no_route"` (or the provided `error_kind`) and carries
/// the original target in the payload.
async fn send_error_reply(state: &RouterState, original: &RouteEnvelope, error_kind: &str) {
    let error_payload = json!({
        "error": error_kind,
        "originalTarget": original.target,
        "originalMessageId": original.message_id,
        "originalKind": original.kind,
    });

    let reply = RouteEnvelope::new(
        RouteAddress::new(
            &state.node_id,
            Option::<String>::None,
            Option::<String>::None,
        ),
        original.source.clone(),
        error_kind,
        error_payload,
    );

    state.emit_tap(TapEvent::ErrorReply {
        original_target: original.target.clone(),
        error_kind: error_kind.to_string(),
        reply_envelope: reply.clone(),
    });

    // Try to route the error reply back to the source.
    // Use a recursive call but with a guard: error replies don't generate
    // further error replies (avoid infinite loops).
    if reply.kind.starts_with("error.") {
        // Directly try to forward without generating more errors.
        let avoid: Option<NextHop> = None;
        if let Some(entry) = state
            .route_table
            .read()
            .await
            .resolve(&reply.target, avoid.as_ref())
        {
            match entry.hop {
                NextHop::Peer(peer_id) => {
                    let peers = state.peers.read().await;
                    if let Some(tx) = peers.get(&peer_id) {
                        let _ = tx.send(WireMessage::Envelope {
                            envelope: Box::new(reply),
                        });
                    }
                }
                NextHop::Upstream(upstream_id) => {
                    let upstreams = state.upstreams.read().await;
                    if let Some(tx) = upstreams.get(&upstream_id) {
                        let _ = tx.send(WireMessage::Envelope {
                            envelope: Box::new(reply),
                        });
                    }
                }
            }
        }
        // If we can't route the error reply either, just drop it silently.
    }
}

pub async fn run_demo_client(
    config: DemoClientConfig,
    done: Option<oneshot::Sender<RouteEnvelope>>,
) -> Result<()> {
    let (ws, _) = connect_async(&config.router_url)
        .await
        .with_context(|| format!("connect client {} to {}", config.node_id, config.router_url))?;
    let (mut writer, mut reader) = ws.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<WireMessage>();

    let node_id = config.node_id.clone();
    let writer_task = tokio::spawn(async move {
        while let Some(message) = rx.recv().await {
            let Ok(text) = serde_json::to_string(&message) else {
                continue;
            };
            if writer.send(Message::Text(text.into())).await.is_err() {
                break;
            }
        }
    });

    tx.send(WireMessage::Hello {
        node_id: config.node_id.clone(),
        role: config.role.clone(),
        routes: vec![RouteAnnouncement::local(config.route.clone())],
    })?;
    info!(client = %config.node_id, route = %config.route.key(), "client registered");

    if let Some(target) = config.initial_target.clone() {
        let tx = tx.clone();
        let source = config.route.clone();
        let node_id = config.node_id.clone();
        tokio::spawn(async move {
            sleep(Duration::from_millis(500)).await;
            let envelope = RouteEnvelope::new(
                source,
                target,
                "demo.ping",
                json!({ "from": node_id, "body": "hello through GlassVein tree" }),
            );
            tx.send(WireMessage::Envelope {
                envelope: Box::new(envelope),
            })
            .ok();
        });
    }

    let mut done = done;
    while let Some(message) = reader.next().await {
        let message = message?;
        if !message.is_text() {
            continue;
        }
        let wire: WireMessage = serde_json::from_str(message.to_text()?)?;
        if let WireMessage::Envelope { envelope } = wire {
            let envelope = *envelope;
            info!(client = %config.node_id, kind = %envelope.kind, source = %envelope.source.key(), target = %envelope.target.key(), hops = ?envelope.route_hops, payload = %envelope.payload, "client received envelope");
            if config.auto_reply && envelope.kind == "demo.ping" {
                let reply = RouteEnvelope::new(
                    config.route.clone(),
                    envelope.source.clone(),
                    "demo.reply",
                    json!({
                        "from": config.node_id,
                        "receivedMessageId": envelope.message_id,
                        "receivedRouteHops": envelope.route_hops,
                    }),
                );
                tx.send(WireMessage::Envelope {
                    envelope: Box::new(reply),
                })
                .ok();
            } else if envelope.kind == "demo.reply" {
                if let Some(sender) = done.take() {
                    sender.send(envelope).ok();
                    break;
                }
            }
        }
    }

    writer_task.abort();
    info!(client = %node_id, "client stopped");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper: build a `RouterState` with multiple dummy upstream channels.
    /// Returns the state and a map of (upstream_id -> receiver).
    async fn build_state_with_upstreams(
        node_id: &str,
        upstream_ids: &[&str],
    ) -> (
        RouterState,
        HashMap<String, mpsc::UnboundedReceiver<WireMessage>>,
    ) {
        let state = RouterState::new(node_id.to_string(), None);
        let mut receivers = HashMap::new();
        {
            let mut upstreams = state.upstreams.write().await;
            for id in upstream_ids {
                let (tx, rx) = mpsc::unbounded_channel();
                upstreams.insert((*id).to_string(), tx);
                receivers.insert((*id).to_string(), rx);
            }
        }
        (state, receivers)
    }

    /// When multiple upstreams exist and no route matches, the fallback must
    /// deterministically pick the lexicographically smallest upstream_id.
    #[tokio::test]
    async fn fallback_selects_lexicographically_smallest_upstream() {
        let (state, mut receivers) = build_state_with_upstreams(
            "test-router",
            &["ws://host-z:9999", "ws://host-a:9999", "ws://host-m:9999"],
        )
        .await;

        let source = RouteAddress::domain("unknown-src");
        let target = RouteAddress::domain("no-such-route");
        let envelope = RouteEnvelope::new(source, target, "test.ping", serde_json::json!({}));

        route_envelope(&state, envelope, None, None).await;

        // Only the smallest upstream_id ("ws://host-a:9999") should have received.
        let rx_a = receivers.get_mut("ws://host-a:9999").unwrap();
        let msg = rx_a
            .try_recv()
            .expect("upstream-a should receive the envelope");
        match msg {
            WireMessage::Envelope { envelope } => {
                assert_eq!(envelope.kind, "test.ping");
            }
            other => panic!("expected Envelope, got: {:?}", other),
        }

        // The other two should be empty.
        let rx_m = receivers.get_mut("ws://host-m:9999").unwrap();
        assert!(rx_m.try_recv().is_err(), "upstream-m should NOT receive");

        let rx_z = receivers.get_mut("ws://host-z:9999").unwrap();
        assert!(rx_z.try_recv().is_err(), "upstream-z should NOT receive");
    }

    /// Repeated calls with the same multi-upstream state must always pick
    /// the same upstream (deterministic, not random or hash-order).
    #[tokio::test]
    async fn fallback_is_deterministic_across_calls() {
        let (state, mut receivers) =
            build_state_with_upstreams("test-router", &["upstream-2", "upstream-1", "upstream-3"])
                .await;

        for i in 0..5 {
            let source = RouteAddress::domain(format!("src-{i}"));
            let target = RouteAddress::domain("no-such-route");
            let envelope = RouteEnvelope::new(source, target, "test.ping", serde_json::json!({}));
            route_envelope(&state, envelope, None, None).await;
        }

        // All 5 messages must land on "upstream-1" (lexicographically smallest).
        let rx_1 = receivers.get_mut("upstream-1").unwrap();
        let mut count = 0;
        while rx_1.try_recv().is_ok() {
            count += 1;
        }
        assert_eq!(count, 5, "all 5 envelopes should go to upstream-1");

        let rx_2 = receivers.get_mut("upstream-2").unwrap();
        assert!(rx_2.try_recv().is_err(), "upstream-2 should be empty");

        let rx_3 = receivers.get_mut("upstream-3").unwrap();
        assert!(rx_3.try_recv().is_err(), "upstream-3 should be empty");
    }

    /// If the envelope arrives from an upstream, it must NOT be forwarded
    /// back to any upstream (no fallback, message is dropped).
    #[tokio::test]
    async fn no_fallback_when_from_upstream() {
        let (state, mut receivers) =
            build_state_with_upstreams("test-router", &["upstream-1"]).await;

        let source = RouteAddress::domain("src");
        let target = RouteAddress::domain("no-such-route");
        let envelope = RouteEnvelope::new(source, target, "test.ping", serde_json::json!({}));

        route_envelope(&state, envelope, None, Some("upstream-1")).await;

        let rx = receivers.get_mut("upstream-1").unwrap();
        assert!(
            rx.try_recv().is_err(),
            "must not forward back to upstream when already from upstream"
        );
    }
}
