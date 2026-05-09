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
use serde_json::json;
use tokio::{
    net::TcpListener,
    sync::{mpsc, oneshot, RwLock},
    time::{sleep, Duration},
};
use tokio_tungstenite::{accept_async, connect_async, tungstenite::Message};
use tracing::{debug, info, warn};

type Tx = mpsc::UnboundedSender<WireMessage>;

#[derive(Clone, Debug)]
pub struct RouterConfig {
    pub node_id: String,
    pub bind_addr: String,
    pub upstream_urls: Vec<String>,
    pub announce_routes: Vec<RouteAddress>,
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

impl RouterState {
    fn new(node_id: String) -> Self {
        Self {
            node_id,
            route_table: Arc::new(RwLock::new(RouteTable::default())),
            peers: Arc::new(RwLock::new(HashMap::new())),
            peer_roles: Arc::new(RwLock::new(HashMap::new())),
            upstreams: Arc::new(RwLock::new(HashMap::new())),
            metrics: Arc::new(RouterMetrics::default()),
        }
    }
}

pub async fn run_router(config: RouterConfig) -> Result<()> {
    let state = RouterState::new(config.node_id.clone());

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
                    envelope,
                    peer_id.as_deref(),
                    is_upstream.then(|| upstream_key.as_deref()).flatten(),
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
            .filter_map(|(peer_id, role)| matches!(role, NodeRole::Router).then(|| peer_id.clone()))
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
    let Some(envelope) = envelope.hop(state.node_id.clone()) else {
        state.metrics.record_drop();
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
                    tx.send(WireMessage::Envelope { envelope }).ok();
                    return;
                }
            }
            NextHop::Upstream(upstream_id) => {
                let upstreams = state.upstreams.read().await;
                if let Some(tx) = upstreams.get(&upstream_id) {
                    info!(router = %state.node_id, %upstream_id, distance = entry.distance, target = %envelope.target.key(), kind = %envelope.kind, "forward upstream shortest path");
                    state.metrics.record_forward(&envelope);
                    tx.send(WireMessage::Envelope { envelope }).ok();
                    return;
                }
            }
        }
    }

    if from_upstream.is_none() {
        if let Some((upstream_id, tx)) = state
            .upstreams
            .read()
            .await
            .iter()
            .map(|(id, tx)| (id.clone(), tx.clone()))
            .next()
        {
            info!(router = %state.node_id, %upstream_id, target = %envelope.target.key(), kind = %envelope.kind, "forward upstream");
            state.metrics.record_forward(&envelope);
            tx.send(WireMessage::Envelope { envelope }).ok();
            return;
        }
    }

    state.metrics.record_drop();
    warn!(router = %state.node_id, target = %envelope.target.key(), kind = %envelope.kind, "drop envelope: no route");
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
            tx.send(WireMessage::Envelope { envelope }).ok();
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
                tx.send(WireMessage::Envelope { envelope: reply }).ok();
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
