//! WebSocket transport implementations.

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use anyhow::Result;
use async_trait::async_trait;
use futures_util::{SinkExt, StreamExt};
use osgp::LinkMessage;
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};
use tracing::{info, warn};

use super::transport::Transport;

/// WebSocket transport placeholder (use `WebSocketTransportHandle` for production).
pub struct WebSocketTransport {
    url: String,
    ws: Option<WebSocketStream<MaybeTlsStream<TcpStream>>>,
    connected: bool,
}

impl WebSocketTransport {
    /// Create a new WebSocket transport targeting the given URL.
    pub fn new(url: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            ws: None,
            connected: false,
        }
    }

    /// Establish the WebSocket connection.
    pub async fn connect(&mut self) -> Result<()> {
        let (ws, _) = connect_async(&self.url)
            .await
            .map_err(|e| anyhow::anyhow!("WebSocket connect failed: {}", e))?;
        self.ws = Some(ws);
        self.connected = true;
        info!(url = %self.url, "WebSocket connected");
        Ok(())
    }
}

#[async_trait]
impl Transport for WebSocketTransport {
    async fn send_message(&self, _message: LinkMessage) -> Result<()> {
        Err(anyhow::anyhow!(
            "WebSocketTransport is a placeholder; use WebSocketTransportHandle instead"
        ))
    }

    async fn receive_message(&self) -> Result<Option<LinkMessage>> {
        Err(anyhow::anyhow!(
            "WebSocketTransport is a placeholder; use WebSocketTransportHandle instead"
        ))
    }

    fn is_connected(&self) -> bool {
        self.connected
    }

    async fn close(&self) -> Result<()> {
        Ok(())
    }
}

/// Handle-based WebSocket transport that splits read/write for concurrent access.
///
/// ## Hello handshake
///
/// The OSGP router expects the first message on a new connection to be a
/// `HelloMessage` (raw JSON, not a `LinkMessage`). Use `send_raw_text()` to
/// send it, and `receive_raw_text()` to read the router's reply, *before* using
/// the normal `Transport::send_message` / `Transport::receive_message` API.
pub struct WebSocketTransportHandle {
    tx: mpsc::UnboundedSender<LinkMessage>,
    raw_tx: mpsc::UnboundedSender<String>,
    rx: Arc<tokio::sync::Mutex<mpsc::UnboundedReceiver<LinkMessage>>>,
    raw_rx: Arc<tokio::sync::Mutex<mpsc::UnboundedReceiver<String>>>,
    connected: Arc<AtomicBool>,
}

impl WebSocketTransportHandle {
    /// Connect to a WebSocket router and return a handle.
    pub async fn connect(url: &str) -> Result<Self> {
        let (ws, _) = connect_async(url)
            .await
            .map_err(|e| anyhow::anyhow!("WebSocket connect to {} failed: {}", url, e))?;

        let (mut writer, mut reader) = ws.split();
        let (tx, mut rx) = mpsc::unbounded_channel::<LinkMessage>();
        let (incoming_tx, incoming_rx) = mpsc::unbounded_channel::<LinkMessage>();
        let (raw_tx, mut raw_rx) = mpsc::unbounded_channel::<String>();
        let (raw_incoming_tx, raw_incoming_rx) = mpsc::unbounded_channel::<String>();
        let connected = Arc::new(AtomicBool::new(true));

        // Spawn writer task: prioritize raw text (Hello handshake) over LinkMessages
        let connected_writer = connected.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    biased;
                    raw = raw_rx.recv() => {
                        match raw {
                            Some(text) => {
                                if writer.send(Message::Text(text.into())).await.is_err() {
                                    warn!("WebSocket write (raw) failed");
                                    break;
                                }
                            }
                            None => break,
                        }
                    }
                    msg = rx.recv() => {
                        match msg {
                            Some(message) => {
                                match serde_json::to_string(&message) {
                                    Ok(json) => {
                                        if writer.send(Message::Text(json.into())).await.is_err() {
                                            warn!("WebSocket write failed");
                                            break;
                                        }
                                    }
                                    Err(e) => {
                                        warn!(error = %e, "Failed to serialize LinkMessage");
                                    }
                                }
                            }
                            None => break,
                        }
                    }
                }
            }
            connected_writer.store(false, Ordering::SeqCst);
        });

        // Spawn reader task
        let connected_reader = connected.clone();
        tokio::spawn(async move {
            while let Some(msg) = reader.next().await {
                match msg {
                    Ok(Message::Text(text)) => {
                        match serde_json::from_str::<LinkMessage>(&text) {
                            Ok(link_msg) => {
                                if incoming_tx.send(link_msg).is_err() {
                                    break;
                                }
                            }
                            Err(_) => {
                                if raw_incoming_tx.send(text.to_string()).is_err() {
                                    break;
                                }
                            }
                        }
                    }
                    Ok(Message::Close(_)) => {
                        info!("WebSocket closed by remote");
                        break;
                    }
                    Err(e) => {
                        warn!(error = %e, "WebSocket read error");
                        break;
                    }
                    _ => {}
                }
            }
            connected_reader.store(false, Ordering::SeqCst);
        });

        info!(url = %url, "WebSocket transport connected");
        Ok(Self {
            tx,
            raw_tx,
            rx: Arc::new(tokio::sync::Mutex::new(incoming_rx)),
            raw_rx: Arc::new(tokio::sync::Mutex::new(raw_incoming_rx)),
            connected,
        })
    }

    /// Send raw text over the WebSocket connection.
    ///
    /// Use this for the Hello handshake (which is NOT a `LinkMessage`).
    pub async fn send_raw_text(&self, text: &str) -> Result<()> {
        self.raw_tx
            .send(text.to_string())
            .map_err(|e| anyhow::anyhow!("raw send failed: {}", e))
    }

    /// Receive raw text from the WebSocket connection.
    pub async fn receive_raw_text(&self) -> Result<Option<String>> {
        let mut rx = self.raw_rx.lock().await;
        Ok(rx.recv().await)
    }
}

#[async_trait]
impl Transport for WebSocketTransportHandle {
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
        self.connected.load(Ordering::SeqCst) && !self.tx.is_closed()
    }

    async fn close(&self) -> Result<()> {
        self.connected.store(false, Ordering::SeqCst);
        Ok(())
    }
}
