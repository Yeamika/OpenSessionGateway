//! Peer connection handling — Hello handshake, registration, writer loop.

use anyhow::{Context, Result};
use osgp::LinkMessage;
use tokio::sync::mpsc;
use tokio_tungstenite::accept_async;
use tracing::{info, warn};

use crate::transport::{PeerHandle, PeerRole};

use super::link_io::{self, FrameReader, FrameSink, WireFrame};
use super::ConnectionManager;

/// Parse the first frame as either a new `LinkHandshake` or a legacy
/// `HelloMessage`. Returns `(peer_id, peer_role, addresses, capabilities)`.
///
/// The legacy path is isolated here so deprecation warnings are confined
/// to this single function.
#[allow(deprecated)]
fn parse_hello_frame(
    text: &str,
) -> anyhow::Result<(String, PeerRole, Vec<osgp::SessionAddress>, Vec<String>)> {
    // Try LinkHandshake first (has protocol_version, peer_id, no role)
    if let Ok(hs) = serde_json::from_str::<osgp::LinkHandshake>(text) {
        // LinkHandshake: peer_id is the identity, role defaults to Endpoint,
        // no addresses (those come via Announce). Capabilities can be
        // optionally declared via metadata.capabilities.
        let capabilities = hs
            .metadata
            .as_ref()
            .and_then(|m| m.get("capabilities"))
            .and_then(|v| serde_json::from_value::<Vec<String>>(v.clone()).ok())
            .unwrap_or_default();
        return Ok((hs.peer_id, PeerRole::Endpoint, Vec::new(), capabilities));
    }
    // Fall back to legacy HelloMessage
    let hello: HelloMessage = serde_json::from_str(text).context("parse Hello")?;
    let peer_role =
        PeerRole::try_from(hello.role).map_err(|e| anyhow::anyhow!("invalid role: {}", e))?;
    Ok((
        hello.node_id,
        peer_role,
        hello.addresses,
        hello.capabilities,
    ))
}

#[allow(deprecated)]
fn make_hello_reply(node_id: &str) -> HelloMessage {
    HelloMessage {
        node_id: node_id.to_string(),
        role: Role::Router,
        addresses: Vec::new(),
        capabilities: Vec::new(),
    }
}

#[allow(deprecated)]
use osgp::{HelloMessage, Role};

impl ConnectionManager {
    /// Handle a single incoming WebSocket connection.
    pub(crate) async fn handle_incoming_connection<S>(
        &self,
        stream: S,
        peer_addr: String,
    ) -> Result<()>
    where
        S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
    {
        let ws = accept_async(stream)
            .await
            .with_context(|| format!("ws accept from {}", peer_addr))?;

        let (sink, reader) = link_io::split_tungstenite_ws(ws);

        self.handle_incoming_link(peer_addr, reader, sink).await
    }

    /// Handle a single accepted link using router-local raw frame I/O.
    ///
    /// This is the reusable inbound listener seam. Concrete listener backends
    /// (the current tokio-tungstenite path, and future Pingora listener path)
    /// are responsible only for accepting a WebSocket and adapting it to a
    /// [`FrameReader`] + [`FrameSink`]. Router semantics stay here: Hello,
    /// peer lifecycle, dispatch, and cleanup.
    pub(crate) async fn handle_incoming_link<Reader, Sink>(
        &self,
        peer_addr: String,
        mut reader: Reader,
        mut sink: Sink,
    ) -> Result<()>
    where
        Reader: FrameReader + Send,
        Sink: FrameSink + Send + 'static,
    {
        let (tx, mut rx) = mpsc::unbounded_channel::<LinkMessage>();

        // Step 1: Wait for Hello from the peer
        let hello_frame = reader
            .next_text_frame()
            .await
            .ok_or_else(|| anyhow::anyhow!("connection closed before Hello"))?
            .context("read Hello frame")?;

        // Parse as LinkHandshake or legacy HelloMessage
        let (peer_id, peer_role, peer_addresses, peer_capabilities) =
            parse_hello_frame(hello_frame.as_text())?;

        info!(
            router = %self.node_id,
            peer_addr = %peer_addr,
            peer = %peer_id,
            role = ?peer_role,
            addresses = peer_addresses.len(),
            capabilities = peer_capabilities.len(),
            "peer connected"
        );

        // Step 1b: Send Hello reply back to the peer (always legacy format for compat)
        let hello_reply = make_hello_reply(&self.node_id);
        let reply_frame = WireFrame::from_json(&hello_reply)?;
        sink.send_frame(reply_frame)
            .await
            .context("send Hello reply")?;

        // Step 2: Register the peer
        let handle = PeerHandle::new(&peer_id, peer_role.clone(), tx.clone())
            .with_capabilities(peer_capabilities);
        self.peers.write().await.insert(peer_id.clone(), handle);

        // Track addresses for cleanup and direct address lookup
        if !peer_addresses.is_empty() {
            self.peer_routes
                .write()
                .await
                .insert(peer_id.clone(), peer_addresses.clone());
        }

        // Step 3: Invoke callback if set.
        // The callback learns Hello addresses into the route table and
        // propagates them to upstream, making Hello addresses equivalent
        // to Announce messages.
        {
            let cb = self.on_peer_connect.lock().await;
            if let Some(cb) = cb.as_ref() {
                cb(peer_id.clone(), peer_role.clone(), peer_addresses);
            }
        }

        // Step 4: Spawn writer task
        let writer_task = tokio::spawn(async move {
            link_io::run_plain_writer(&mut sink, &mut rx).await;
        });

        // Step 5: Read loop (inbound messages from this peer)
        while let Some(result) = reader.next_text_frame().await {
            let frame = match result {
                Ok(f) => f,
                Err(e) => {
                    warn!(peer = %peer_id, error = %e, "frame read error");
                    break;
                }
            };
            let link_msg: LinkMessage = match frame.to_link_message() {
                Ok(m) => m,
                Err(e) => {
                    warn!(peer = %peer_id, error = %e, "invalid message");
                    continue;
                }
            };
            self.dispatch_message(&peer_id, &peer_role, link_msg).await;
        }

        // Step 6: Cleanup on disconnect
        self.unregister_peer(&peer_id).await;
        writer_task.abort();

        info!(router = %self.node_id, peer_addr = %peer_addr, peer = %peer_id, "peer disconnected");
        Ok(())
    }
}
