//! Pingora-backed transport adapter.
//!
//! Uses Pingora's server runtime to accept TCP/TLS connections, then performs
//! WebSocket handshake via `tokio-tungstenite`. The resulting WebSocket stream
//! implements core's [`Transport`] trait.
//!
//! ## Architecture
//!
//! ```text
//! Pingora Server (TCP/TLS accept)
//!       │
//!       ▼
//! PingoraServerApp::process_new(stream)
//!       │
//!       ▼
//! tokio_tungstenite::accept_async(stream)  ← WebSocket handshake
//!       │
//!       ▼
//! PingoraTransport(ws_stream)  ← implements core::Transport
//!       │
//!       ▼
//! ForwardEngine / TransportMap
//! ```
//!
//! ## Usage
//!
//! ```rust,ignore
//! use core::transport::pingora::{PingoraServerApp, PingoraTransportFactory};
//!
//! let app = PingoraServerApp::new("my-router".into());
//! let factory = app.factory();
//!
//! // Register with Pingora server (see Pingora docs)
//! // Then accept transports:
//! let transport = factory.accept().await?;
//! ```

use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use futures_util::{stream::SplitSink, stream::SplitStream, SinkExt, StreamExt};
use osgp::LinkMessage;
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::WebSocketStream;
use tracing::{debug, info, warn};

use super::{Transport, TransportFactory};

// ── PingoraTransport ────────────────────────────────────────────────

/// A transport backed by a WebSocket stream over a Pingora-accepted connection.
///
/// Wraps `WebSocketStream<pingora_core::protocols::Stream>` and implements
/// core's [`Transport`] trait for sending/receiving `LinkMessage` JSON.
///
/// ## Raw frame API
///
/// In addition to the typed [`Transport`] methods, `PingoraTransport` exposes
/// [`send_text`](Self::send_text) and [`recv_text`](Self::recv_text) for
/// sending/receiving raw WS text frames. This allows higher layers (e.g. a
/// router's Hello handshake) to exchange arbitrary JSON **before** entering the
/// typed `LinkMessage` loop.
///
/// ```text
/// Router accept loop:
///   1. factory.accept() → PingoraTransport
///   2. transport.recv_text()  → raw HelloMessage JSON
///   3. transport.send_text()  → HelloReply JSON
///   4. hand Arc<PingoraTransport> to ForwardEngine as Transport
/// ```
pub struct PingoraTransport {
    sink: Arc<
        Mutex<
            SplitSink<
                WebSocketStream<pingora_core::protocols::Stream>,
                tokio_tungstenite::tungstenite::Message,
            >,
        >,
    >,
    stream: Arc<Mutex<SplitStream<WebSocketStream<pingora_core::protocols::Stream>>>>,
    peer_addr: String,
}

impl PingoraTransport {
    /// Create a new Pingora transport from an accepted WebSocket stream.
    pub fn new(ws: WebSocketStream<pingora_core::protocols::Stream>, peer_addr: String) -> Self {
        let (sink, stream) = ws.split();
        Self {
            sink: Arc::new(Mutex::new(sink)),
            stream: Arc::new(Mutex::new(stream)),
            peer_addr,
        }
    }

    /// Get the peer address string.
    pub fn peer_addr(&self) -> &str {
        &self.peer_addr
    }

    // ── Raw text frame API ───────────────────────────────────────────

    /// Send a raw text frame over the WebSocket.
    ///
    /// Use this for pre-handshake or non-`LinkMessage` frames (e.g. Hello
    /// handshake). The typed [`Transport::send`] delegates here after
    /// serialising to JSON.
    pub async fn send_text(&self, text: impl Into<String> + Send) -> Result<()> {
        let mut sink = self.sink.lock().await;
        sink.send(tokio_tungstenite::tungstenite::Message::Text(
            text.into().into(),
        ))
        .await
        .map_err(|e| anyhow::anyhow!("ws send error: {}", e))
    }

    /// Receive the next WebSocket text frame as a raw `String`.
    ///
    /// Skips non-text frames (binary, ping, pong). Returns `Ok(None)` when
    /// the remote end has closed the connection or the stream is exhausted.
    /// Returns `Err` on protocol-level read errors.
    pub async fn recv_text(&self) -> Result<Option<String>> {
        let mut stream = self.stream.lock().await;
        loop {
            match stream.next().await {
                Some(Ok(tokio_tungstenite::tungstenite::Message::Text(text))) => {
                    return Ok(Some(text.as_str().to_owned()));
                }
                Some(Ok(tokio_tungstenite::tungstenite::Message::Close(_))) => {
                    debug!(peer = %self.peer_addr, "ws closed by peer");
                    return Ok(None);
                }
                Some(Ok(_)) => {
                    // Ignore non-text frames (binary, ping, pong)
                    continue;
                }
                Some(Err(e)) => {
                    return Err(anyhow::anyhow!("ws recv error: {}", e));
                }
                None => {
                    return Ok(None);
                }
            }
        }
    }

    /// Send a WebSocket close frame and shut down the stream.
    ///
    /// Functionally identical to [`Transport::close`]; exposed with a
    /// concrete name for callers that prefer not to go through the trait.
    pub async fn close_ws(&self) -> Result<()> {
        let mut sink = self.sink.lock().await;
        sink.close()
            .await
            .map_err(|e| anyhow::anyhow!("ws close error: {}", e))
    }
}

#[async_trait]
impl Transport for PingoraTransport {
    async fn send(&self, message: LinkMessage) -> Result<()> {
        let json = serde_json::to_string(&message)?;
        self.send_text(json).await
    }

    async fn recv(&self) -> Result<Option<LinkMessage>> {
        loop {
            match self.recv_text().await? {
                Some(text) => match serde_json::from_str::<LinkMessage>(&text) {
                    Ok(msg) => return Ok(Some(msg)),
                    Err(e) => {
                        warn!(error = %e, "failed to parse LinkMessage from WS frame");
                        continue;
                    }
                },
                None => return Ok(None),
            }
        }
    }

    async fn close(&self) -> Result<()> {
        self.close_ws().await
    }
}

// ── PingoraServerApp ────────────────────────────────────────────────

/// Pingora `ServerApp` implementation that accepts WebSocket connections.
///
/// When Pingora's server runtime accepts a TCP/TLS connection, this app
/// performs the WebSocket handshake and hands the resulting transport
/// to the [`PingoraTransportFactory`] via an internal channel.
pub struct PingoraServerApp {
    node_id: String,
    /// Channel sender: pushes accepted transports to the factory.
    tx: mpsc::UnboundedSender<AcceptedTransport>,
}

/// An accepted transport ready to be consumed by the factory.
struct AcceptedTransport {
    transport: PingoraTransport,
}

impl PingoraServerApp {
    /// Create a new Pingora server app and its paired factory.
    ///
    /// Returns `(app, factory)` where `app` is registered with Pingora's
    /// server and `factory` implements `TransportFactory::accept`.
    ///
    /// The `app` is passed to `pingora_core::services::listening::Service::new`
    /// which wraps it in `Arc` internally.
    pub fn new(node_id: String) -> (Self, PingoraTransportFactory) {
        let (tx, rx) = mpsc::unbounded_channel();
        let app = Self {
            node_id: node_id.clone(),
            tx,
        };
        let factory = PingoraTransportFactory {
            node_id,
            rx: Arc::new(Mutex::new(rx)),
        };
        (app, factory)
    }
}

impl pingora_core::apps::ServerApp for PingoraServerApp {
    fn process_new<'life0, 'life1, 'async_trait>(
        self: &'life0 Arc<Self>,
        stream: pingora_core::protocols::Stream,
        _shutdown: &'life1 pingora_core::server::ShutdownWatch,
    ) -> std::pin::Pin<
        Box<
            dyn std::future::Future<Output = Option<pingora_core::protocols::Stream>>
                + Send
                + 'async_trait,
        >,
    >
    where
        Self: 'async_trait,
        'life0: 'async_trait,
        'life1: 'async_trait,
    {
        let node_id = self.node_id.clone();
        let tx = self.tx.clone();

        Box::pin(async move {
            // Perform WebSocket handshake on the Pingora Stream.
            // Pingora's Stream is Box<dyn IO> which implements
            // AsyncRead + AsyncWrite + Unpin + Send + 'static,
            // satisfying tokio-tungstenite's requirements.
            let peer_addr = format!("{:?}", &stream as *const _);

            match tokio_tungstenite::accept_async(stream).await {
                Ok(ws) => {
                    info!(node_id = %node_id, peer = %peer_addr, "ws handshake complete");
                    let transport = PingoraTransport::new(ws, peer_addr);
                    if tx.send(AcceptedTransport { transport }).is_err() {
                        warn!(node_id = %node_id, "factory receiver dropped, discarding connection");
                    }
                    // Connection consumed; return None to Pingora
                    None
                }
                Err(e) => {
                    warn!(node_id = %node_id, error = %e, "ws handshake failed");
                    None
                }
            }
        })
    }
}

// ── PingoraTransportFactory ─────────────────────────────────────────

/// A transport factory that receives accepted connections from Pingora's
/// server runtime via an internal channel.
///
/// Implements core's [`TransportFactory`] trait so it can be used with
/// [`TransportMap`] and [`ForwardEngine`](crate::forward::ForwardEngine).
pub struct PingoraTransportFactory {
    node_id: String,
    rx: Arc<Mutex<mpsc::UnboundedReceiver<AcceptedTransport>>>,
}

#[async_trait]
impl TransportFactory for PingoraTransportFactory {
    type Transport = PingoraTransport;

    /// Accept one incoming WebSocket connection from Pingora's server.
    ///
    /// Returns `Ok(None)` when the channel is closed (server shut down).
    async fn accept(&self) -> Result<Option<Self::Transport>> {
        let mut rx = self.rx.lock().await;
        match rx.recv().await {
            Some(AcceptedTransport { transport }) => {
                debug!(node_id = %self.node_id, peer = %transport.peer_addr(), "transport accepted via Pingora");
                Ok(Some(transport))
            }
            None => {
                info!(node_id = %self.node_id, "pingora transport factory channel closed");
                Ok(None)
            }
        }
    }

    /// Connect to a remote WebSocket endpoint.
    ///
    /// **Not supported** for `PingoraTransportFactory`. This factory is
    /// designed for server-side accept via Pingora's runtime.
    /// For client-side connections, use `tokio-tungstenite::connect_async`
    /// directly and wrap in a custom transport type.
    async fn connect(&self, _addr: &str) -> Result<Self::Transport> {
        anyhow::bail!(
            "PingoraTransportFactory::connect is not supported; \
             use a client-side transport factory instead"
        )
    }
}

// ── Pingora Server Builder Helper ───────────────────────────────────

/// Build a Pingora `listening::Service` with the given `PingoraServerApp`.
///
/// This is a convenience function that wires up a Pingora listening service
/// with the WebSocket adapter. The caller is responsible for adding it to
/// a Pingora `Server` and running it.
///
/// # Example
///
/// ```rust,ignore
/// use core::transport::pingora::{PingoraServerApp, build_pingora_service};
///
/// let (app, factory) = PingoraServerApp::new("router-1".into());
/// let mut service = build_pingora_service("gv-router".into(), app);
/// service.add_tcp("127.0.0.1:7100");
///
/// // Register with Pingora server and run
/// ```
pub fn build_pingora_service(
    name: String,
    app: PingoraServerApp,
) -> pingora_core::services::listening::Service<PingoraServerApp> {
    pingora_core::services::listening::Service::new(name, app)
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pingora_transport_factory_implements_trait() {
        // Verify the trait bounds compile
        fn _assert_factory<T: TransportFactory>() {}
        _assert_factory::<PingoraTransportFactory>();
    }

    #[test]
    fn pingora_transport_implements_trait() {
        // Verify the trait bounds compile
        fn _assert_transport<T: Transport>() {}
        _assert_transport::<PingoraTransport>();
    }

    // ── Raw frame API contract tests ────────────────────────────────
    //
    // PingoraTransport cannot be constructed without a real Pingora
    // Stream, so we verify API surface at compile time: the methods
    // exist on `&PingoraTransport` with the expected signatures.

    /// Statically asserts that `send_text`, `recv_text`, and `close_ws`
    /// exist as async `&self` methods. If any method is removed or its
    /// signature changes incompatibly, this stops compiling.
    ///
    /// We use an `async fn` body so the compiler resolves the method
    /// calls without needing a concrete `PingoraTransport` value.
    #[allow(unused)]
    async fn _assert_raw_frame_api(transport: &PingoraTransport) {
        let _: Result<()> = transport.send_text("hello".to_owned()).await;
        let _: Result<Option<String>> = transport.recv_text().await;
        let _: Result<()> = transport.close_ws().await;
        let _: &str = transport.peer_addr();
    }

    #[test]
    fn pingora_raw_frame_api_compiles() {
        // If `_assert_raw_frame_api` compiles, all methods exist with
        // correct signatures. We don't call it (no real stream available).
        fn _exists() {}
        _exists();
    }

    /// Verify that `PingoraTransport` implements both `Transport` (via
    /// delegation to raw API) and has inherent raw methods simultaneously.
    #[test]
    fn pingora_transport_has_trait_and_raw_api() {
        fn _check<T: Transport>() {}
        _check::<PingoraTransport>();
    }
}
