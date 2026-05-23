//! WebSocket MITM observe/tap router.
//!
//! Provides transparent WebSocket proxying between downstream clients and an
//! upstream server, plus a `/glassvein/observe` WebSocket endpoint for
//! observers to receive generic frame observation events.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::SystemTime;

use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::json;
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use tokio_tungstenite::{
    accept_hdr_async, connect_async,
    tungstenite::{
        handshake::server::{ErrorResponse, Request, Response},
        Message,
    },
};
use tracing::{info, warn};

/// WebSocket path for observe clients.
pub const GLASSVEIN_OBSERVE_PATH: &str = "/glassvein/observe";

/// Backward-compatible alias.
#[deprecated(since = "0.0.0", note = "Use `GLASSVEIN_OBSERVE_PATH` instead")]
pub const OSG_SESSION_UPDATES_PATH: &str = GLASSVEIN_OBSERVE_PATH;

/// Configuration for the observe/tap MITM proxy.
#[derive(Clone, Debug)]
pub struct ObserveConfig {
    /// Address to bind the listener (e.g. `"127.0.0.1:4090"`).
    pub bind_addr: String,
    /// Upstream WebSocket URL (e.g. `"ws://127.0.0.1:4088/api/v2/wsport"`).
    pub upstream_ws_url: String,
}

/// Backward-compatible alias.
pub type OsgMitmConfig = ObserveConfig;

/// Classification of an incoming WebSocket connection by path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PathClass {
    /// Connection to [`GLASSVEIN_OBSERVE_PATH`] — observe client.
    Observe,
    /// Any other path — downstream to be proxied upstream.
    Downstream,
}

/// Frame direction in the proxied connection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    DownstreamToUpstream,
    UpstreamToDownstream,
}

impl std::fmt::Display for Direction {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::DownstreamToUpstream => f.write_str("downstream_to_upstream"),
            Self::UpstreamToDownstream => f.write_str("upstream_to_downstream"),
        }
    }
}

/// Simplified WebSocket opcode for observation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FrameOpcode {
    Text,
    Binary,
    Ping,
    Pong,
    Close,
    Other,
}

impl std::fmt::Display for FrameOpcode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Text => f.write_str("text"),
            Self::Binary => f.write_str("binary"),
            Self::Ping => f.write_str("ping"),
            Self::Pong => f.write_str("pong"),
            Self::Close => f.write_str("close"),
            Self::Other => f.write_str("other"),
        }
    }
}

/// A generic WebSocket frame observation.
///
/// Broadcast to all observers on [`GLASSVEIN_OBSERVE_PATH`]. The router does
/// **not** parse OSG business payload — that is the responsibility of
/// downstream surface crates.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlassVeinObservation {
    #[serde(rename = "type")]
    pub type_: &'static str,
    #[serde(rename = "connectionID")]
    pub connection_id: String,
    pub direction: Direction,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
    pub opcode: FrameOpcode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub byte_length: Option<usize>,
    pub observed_at: f64,
}

/// Classify the request path.
pub fn classify_path(path: &str) -> PathClass {
    if path == GLASSVEIN_OBSERVE_PATH {
        PathClass::Observe
    } else {
        PathClass::Downstream
    }
}

/// Append a downstream query string to the upstream URL.
///
/// - If `downstream_query` is empty, returns `upstream_url` unchanged.
/// - If `upstream_url` already has a `?`, appends with `&`.
/// - Otherwise, appends with `?`.
pub fn append_query_to_upstream(upstream_url: &str, downstream_query: &str) -> String {
    if downstream_query.is_empty() {
        return upstream_url.to_string();
    }
    if upstream_url.contains('?') {
        format!("{upstream_url}&{downstream_query}")
    } else {
        format!("{upstream_url}?{downstream_query}")
    }
}

/// Derive a [`FrameOpcode`] from a tungstenite [`Message`].
fn frame_opcode(msg: &Message) -> FrameOpcode {
    match msg {
        Message::Text(_) => FrameOpcode::Text,
        Message::Binary(_) => FrameOpcode::Binary,
        Message::Ping(_) => FrameOpcode::Ping,
        Message::Pong(_) => FrameOpcode::Pong,
        Message::Close(_) => FrameOpcode::Close,
        _ => FrameOpcode::Other,
    }
}

/// Construct a [`GlassVeinObservation`] for a proxied frame.
///
/// - Text frames include the raw `text` payload.
/// - Binary / Ping / Pong frames include `byte_length` only (not the payload).
/// - Close and other frames have neither.
pub fn build_observation(
    msg: &Message,
    connection_id: &str,
    direction: &Direction,
    path: &str,
    query: &str,
) -> GlassVeinObservation {
    let opcode = frame_opcode(msg);

    let (text, byte_length) = match msg {
        Message::Text(t) => (Some(t.to_string()), None),
        Message::Binary(b) => (None, Some(b.len())),
        Message::Ping(p) => (None, Some(p.len())),
        Message::Pong(p) => (None, Some(p.len())),
        Message::Close(_) => (None, None),
        _ => (None, None),
    };

    let observed_at = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64();

    GlassVeinObservation {
        type_: "GlassVeinObservation",
        connection_id: connection_id.to_string(),
        direction: direction.clone(),
        path: path.to_string(),
        query: if query.is_empty() {
            None
        } else {
            Some(query.to_string())
        },
        opcode,
        text,
        byte_length,
        observed_at,
    }
}

/// Global connection counter for generating unique connection IDs.
static CONNECTION_COUNTER: AtomicU64 = AtomicU64::new(1);

fn next_connection_id() -> String {
    let id = CONNECTION_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("conn-{id}")
}

/// Run the observe/tap MITM proxy.
///
/// Listens on `config.bind_addr`. For each incoming WebSocket connection:
/// - If the path is [`GLASSVEIN_OBSERVE_PATH`], treats it as an observe
///   client and sends `GlassVeinObserveHello` followed by observation events.
/// - Otherwise, proxies the connection transparently to the upstream server,
///   appending the downstream query string. Every proxied frame in both
///   directions is broadcast as a `GlassVeinObservation` to observe clients.
pub async fn run_observe(config: ObserveConfig) -> Result<()> {
    let (observe_tx, _) = broadcast::channel::<String>(256);

    let listener = TcpListener::bind(&config.bind_addr)
        .await
        .with_context(|| format!("observe bind {}", config.bind_addr))?;
    info!(addr = %config.bind_addr, "observe proxy listening");

    loop {
        let (stream, addr) = listener.accept().await?;
        let observe_tx = observe_tx.clone();
        let upstream_url = config.upstream_ws_url.clone();

        tokio::spawn(async move {
            let captured_path = Arc::new(std::sync::Mutex::new(String::new()));
            let captured_query = Arc::new(std::sync::Mutex::new(String::new()));
            let cp = captured_path.clone();
            let cq = captured_query.clone();

            // ErrorResponse size is dictated by tungstenite's Callback trait; allow large err variant.
            #[allow(clippy::result_large_err)]
            let ws_result = accept_hdr_async(
                stream,
                move |req: &Request, resp: Response| -> Result<Response, ErrorResponse> {
                    let uri = req.uri();
                    *cp.lock().unwrap() = uri.path().to_string();
                    if let Some(q) = uri.query() {
                        *cq.lock().unwrap() = q.to_string();
                    }
                    Ok(resp)
                },
            )
            .await;

            let ws = match ws_result {
                Ok(ws) => ws,
                Err(e) => {
                    warn!(%addr, %e, "observe WebSocket accept failed");
                    return;
                }
            };

            let path = captured_path.lock().unwrap().clone();
            let query = captured_query.lock().unwrap().clone();
            let class = classify_path(&path);

            info!(%addr, %path, ?class, "observe connection classified");

            match class {
                PathClass::Observe => {
                    handle_observe(ws, observe_tx).await;
                }
                PathClass::Downstream => {
                    if let Err(e) =
                        handle_downstream(ws, &upstream_url, &query, &path, &observe_tx).await
                    {
                        warn!(%addr, %e, "observe downstream proxy failed");
                    }
                }
            }
        });
    }
}

/// Backward-compatible entry point.
pub async fn run_osg_mitm(config: ObserveConfig) -> Result<()> {
    run_observe(config).await
}

/// Handle an observe client connection.
///
/// Sends `GlassVeinObserveHello` and then relays broadcast observations until
/// the observe client disconnects.
async fn handle_observe<S>(
    ws: tokio_tungstenite::WebSocketStream<S>,
    observe_tx: broadcast::Sender<String>,
) where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let (mut writer, mut reader) = ws.split();

    // Send hello
    let hello = json!({
        "type": "GlassVeinObserveHello",
        "observe": "glassvein",
    });
    let hello_text = match serde_json::to_string(&hello) {
        Ok(t) => t,
        Err(e) => {
            warn!(%e, "failed to serialize observe hello");
            return;
        }
    };
    if writer.send(Message::Text(hello_text.into())).await.is_err() {
        return;
    }

    let mut rx = observe_tx.subscribe();

    let write_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            if writer.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    // Drain incoming messages from observe client; detect close.
    while let Some(msg) = reader.next().await {
        match msg {
            Ok(Message::Close(_)) | Err(_) => break,
            _ => {}
        }
    }

    write_task.abort();
}

/// Handle a downstream connection by proxying to upstream.
///
/// Each downstream gets its own upstream connection. Both directions of
/// frames are forwarded transparently. Every proxied frame is broadcast
/// as a [`GlassVeinObservation`] to observe clients; broadcast failures
/// never affect forwarding.
async fn handle_downstream<S>(
    downstream_ws: tokio_tungstenite::WebSocketStream<S>,
    upstream_url: &str,
    downstream_query: &str,
    downstream_path: &str,
    observe_tx: &broadcast::Sender<String>,
) -> Result<()>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let target_url = append_query_to_upstream(upstream_url, downstream_query);

    let (upstream_ws, _) = connect_async(&target_url)
        .await
        .with_context(|| format!("connect upstream {}", target_url))?;

    let (mut ds_write, mut ds_read) = downstream_ws.split();
    let (mut us_write, mut us_read) = upstream_ws.split();

    let conn_id = next_connection_id();
    let ds_path = downstream_path.to_string();
    let ds_query = downstream_query.to_string();

    let ds_observe_tx = observe_tx.clone();
    let us_observe_tx = observe_tx.clone();
    let us_conn_id = conn_id.clone();
    let us_path = ds_path.clone();
    let us_query = ds_query.clone();

    // Downstream → Upstream relay
    let relay_ds_to_us = tokio::spawn(async move {
        while let Some(msg_result) = ds_read.next().await {
            match msg_result {
                Ok(msg) => {
                    let observation = build_observation(
                        &msg,
                        &conn_id,
                        &Direction::DownstreamToUpstream,
                        &ds_path,
                        &ds_query,
                    );
                    if let Ok(text) = serde_json::to_string(&observation) {
                        let _ = ds_observe_tx.send(text);
                    }
                    if us_write.send(msg).await.is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    // Upstream → Downstream relay
    let relay_us_to_ds = tokio::spawn(async move {
        while let Some(msg_result) = us_read.next().await {
            match msg_result {
                Ok(msg) => {
                    let observation = build_observation(
                        &msg,
                        &us_conn_id,
                        &Direction::UpstreamToDownstream,
                        &us_path,
                        &us_query,
                    );
                    if let Ok(text) = serde_json::to_string(&observation) {
                        let _ = us_observe_tx.send(text);
                    }
                    if ds_write.send(msg).await.is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    // Wait for either direction to finish
    tokio::select! {
        _ = relay_ds_to_us => {}
        _ = relay_us_to_ds => {}
    }

    Ok(())
}

// ────────────────────────────── Tests ──────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Path classification ──

    #[test]
    fn classify_observe_path() {
        assert_eq!(classify_path("/glassvein/observe"), PathClass::Observe);
    }

    #[test]
    fn classify_other_paths_are_downstream() {
        assert_eq!(classify_path("/"), PathClass::Downstream);
        assert_eq!(classify_path("/api/v2/wsport"), PathClass::Downstream);
        assert_eq!(
            classify_path("/glassvein/observe/extra"),
            PathClass::Downstream
        );
        assert_eq!(classify_path(""), PathClass::Downstream);
    }

    // ── Query appending ──

    #[test]
    fn query_append_empty_query() {
        assert_eq!(
            append_query_to_upstream("ws://host:1234/ws", ""),
            "ws://host:1234/ws"
        );
    }

    #[test]
    fn query_append_no_existing_query() {
        assert_eq!(
            append_query_to_upstream("ws://host:1234/ws", "token=abc"),
            "ws://host:1234/ws?token=abc"
        );
    }

    #[test]
    fn query_append_existing_query() {
        assert_eq!(
            append_query_to_upstream("ws://host:1234/ws?existing=1", "token=abc"),
            "ws://host:1234/ws?existing=1&token=abc"
        );
    }

    // ── Observation construction — text frame ──

    #[test]
    fn observation_text_frame_includes_raw_text() {
        let msg = Message::Text("hello world".into());
        let obs = build_observation(
            &msg,
            "conn-42",
            &Direction::DownstreamToUpstream,
            "/api/ws",
            "token=abc",
        );

        assert_eq!(obs.type_, "GlassVeinObservation");
        assert_eq!(obs.connection_id, "conn-42");
        assert_eq!(obs.direction, Direction::DownstreamToUpstream);
        assert_eq!(obs.path, "/api/ws");
        assert_eq!(obs.query.as_deref(), Some("token=abc"));
        assert_eq!(obs.opcode, FrameOpcode::Text);
        assert_eq!(obs.text.as_deref(), Some("hello world"));
        assert!(obs.byte_length.is_none());
        assert!(obs.observed_at > 0.0);
    }

    #[test]
    fn observation_text_frame_empty_query_serializes_none() {
        let msg = Message::Text("hi".into());
        let obs = build_observation(&msg, "c1", &Direction::UpstreamToDownstream, "/ws", "");

        assert!(obs.query.is_none());
        let serialized = serde_json::to_string(&obs).unwrap();
        assert!(!serialized.contains("\"query\""));
    }

    // ── Observation construction — non-text frames ──

    #[test]
    fn observation_binary_frame_has_byte_length() {
        let msg = Message::Binary(vec![1, 2, 3, 4, 5].into());
        let obs = build_observation(&msg, "conn-1", &Direction::DownstreamToUpstream, "/ws", "");

        assert_eq!(obs.opcode, FrameOpcode::Binary);
        assert!(obs.text.is_none());
        assert_eq!(obs.byte_length, Some(5));
    }

    #[test]
    fn observation_ping_frame() {
        let msg = Message::Ping(vec![0xAA, 0xBB].into());
        let obs = build_observation(&msg, "conn-1", &Direction::UpstreamToDownstream, "/ws", "");

        assert_eq!(obs.opcode, FrameOpcode::Ping);
        assert!(obs.text.is_none());
        assert_eq!(obs.byte_length, Some(2));
    }

    #[test]
    fn observation_pong_frame() {
        let msg = Message::Pong(vec![1, 2, 3].into());
        let obs = build_observation(&msg, "conn-1", &Direction::DownstreamToUpstream, "/ws", "");

        assert_eq!(obs.opcode, FrameOpcode::Pong);
        assert!(obs.text.is_none());
        assert_eq!(obs.byte_length, Some(3));
    }

    #[test]
    fn observation_close_frame_has_neither_text_nor_bytes() {
        let msg = Message::Close(None);
        let obs = build_observation(&msg, "conn-1", &Direction::DownstreamToUpstream, "/ws", "");

        assert_eq!(obs.opcode, FrameOpcode::Close);
        assert!(obs.text.is_none());
        assert!(obs.byte_length.is_none());
    }

    // ── Observation JSON shape ──

    #[test]
    fn observation_serialization_has_required_fields() {
        let msg = Message::Text("payload".into());
        let obs = build_observation(
            &msg,
            "conn-99",
            &Direction::DownstreamToUpstream,
            "/test",
            "x=1",
        );
        let v: serde_json::Value = serde_json::to_value(&obs).unwrap();

        assert_eq!(v["type"], "GlassVeinObservation");
        assert_eq!(v["connectionID"], "conn-99");
        assert_eq!(v["direction"], "downstream_to_upstream");
        assert_eq!(v["path"], "/test");
        assert_eq!(v["query"], "x=1");
        assert_eq!(v["opcode"], "text");
        assert_eq!(v["text"], "payload");
        assert!(v["byteLength"].is_null());
        assert!(v["observedAt"].is_number());
    }

    // ── No OSG-specific builder ──

    #[test]
    fn no_try_build_session_update_function() {
        // Verify the old OSG-specific function does not exist by checking
        // that we can construct observations for any text without special
        // JSON structure requirements.
        let arbitrary_text = r#"{"type":"anything","data":{"session":{"k":"v"}}}"#;
        let msg = Message::Text(arbitrary_text.into());
        let obs = build_observation(&msg, "conn-1", &Direction::DownstreamToUpstream, "/ws", "");
        // The observation includes raw text, no parsing of OSG payload.
        assert_eq!(obs.opcode, FrameOpcode::Text);
        assert_eq!(obs.text.as_deref(), Some(arbitrary_text));
    }

    // ── Deprecated path constant ──

    #[test]
    #[allow(deprecated)]
    fn deprecated_path_constant_still_works() {
        assert_eq!(OSG_SESSION_UPDATES_PATH, GLASSVEIN_OBSERVE_PATH);
    }
}
