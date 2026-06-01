//! Upstream (parent) router connection.

use std::sync::Arc;

use anyhow::{Context, Result};
use osgp::{LinkMessage, SessionAddress};
use tokio::sync::mpsc;
use tokio_tungstenite::connect_async;
use tracing::{info, warn};

use crate::transport::{PeerRole, UpstreamHandle};

use super::config::UpstreamConfig;
use super::link_io::{self, WireFrame};
use super::ConnectionManager;

/// Build a legacy HelloMessage for sending to upstream.
/// Isolated here to contain `#[allow(deprecated)]`.
#[allow(deprecated)]
fn make_upstream_hello(
    node_id: &str,
    announce_routes: &[SessionAddress],
) -> osgp::HelloMessage {
    osgp::HelloMessage {
        node_id: node_id.to_string(),
        role: osgp::Role::Router,
        addresses: announce_routes.to_vec(),
        capabilities: Vec::new(),
    }
}

/// Parse a reply frame as LinkHandshake or legacy HelloMessage.
/// Returns the upstream node_id.
#[allow(deprecated)]
fn parse_upstream_reply(text: &str) -> anyhow::Result<String> {
    if let Ok(hs) = serde_json::from_str::<osgp::LinkHandshake>(text) {
        return Ok(hs.peer_id);
    }
    let reply: osgp::HelloMessage = serde_json::from_str(text).context("parse Hello reply")?;
    Ok(reply.node_id)
}

impl ConnectionManager {
    /// Connect to the upstream (parent) router.
    ///
    /// Performs Hello handshake and starts a message processing loop.
    /// Reconnects automatically on disconnection (with backoff).
    pub async fn connect_upstream(self: &Arc<Self>, config: &UpstreamConfig) -> Result<()> {
        let url = config.url.clone();
        let announce_routes = config.announce_routes.clone();
        let mgr = Arc::clone(self);

        tokio::spawn(async move {
            let mut retry_delay = std::time::Duration::from_millis(100);

            loop {
                info!(router = %mgr.node_id, url = %url, "connecting upstream");

                match mgr.try_connect_upstream(&url, &announce_routes).await {
                    Ok(()) => {
                        info!(router = %mgr.node_id, url = %url, "upstream disconnected, reconnecting");
                    }
                    Err(e) => {
                        warn!(router = %mgr.node_id, url = %url, error = %e, "upstream connection failed");
                    }
                }

                tokio::time::sleep(retry_delay).await;
                retry_delay = (retry_delay * 2).min(std::time::Duration::from_secs(5));
            }
        });

        Ok(())
    }

    /// Single attempt to connect to upstream.
    pub(crate) async fn try_connect_upstream(
        &self,
        url: &str,
        announce_routes: &[SessionAddress],
    ) -> Result<()> {
        let (ws, _) = connect_async(url)
            .await
            .with_context(|| format!("connect to {}", url))?;

        let (mut sink, mut reader) = link_io::split_tungstenite_ws(ws);
        let (tx, mut rx) = mpsc::unbounded_channel::<LinkMessage>();

        // Send Hello (legacy format for backward compat)
        let hello = make_upstream_hello(&self.node_id, announce_routes);
        let hello_frame = WireFrame::from_json(&hello)?;
        sink.send_frame(hello_frame)
            .await
            .context("send Hello to upstream")?;

        // Wait for upstream's Hello reply
        let reply_frame = reader
            .next_text_frame()
            .await
            .ok_or_else(|| anyhow::anyhow!("upstream closed before Hello reply"))?
            .context("read Hello reply frame")?;

        let upstream_id = parse_upstream_reply(reply_frame.as_text())?;
        info!(
            router = %self.node_id,
            upstream = %upstream_id,
            "connected to upstream"
        );

        // Store upstream handle
        let handle = UpstreamHandle::new(&upstream_id, tx.clone());
        *self.upstream.write().await = Some(handle);

        // Spawn writer task
        let writer_task = tokio::spawn(async move {
            link_io::run_plain_writer(&mut sink, &mut rx).await;
        });

        // Learn routes from upstream's Hello reply.
        // Try to parse as HelloMessage to extract addresses (LinkHandshake
        // doesn't carry addresses, so skip if it's the new format).
        #[allow(deprecated)]
        if let Ok(hello_reply) = serde_json::from_str::<osgp::HelloMessage>(reply_frame.as_text())
        {
            for addr in hello_reply.addresses {
                self.dispatch_message(
                    &upstream_id,
                    &PeerRole::Router,
                    LinkMessage::Announce {
                        address: addr,
                        distance: 1,
                    },
                )
                .await;
            }
        }

        // Read loop
        while let Some(result) = reader.next_text_frame().await {
            let frame = match result {
                Ok(f) => f,
                Err(e) => {
                    warn!(upstream = %upstream_id, error = %e, "upstream frame read error");
                    break;
                }
            };
            let link_msg: LinkMessage = match frame.to_link_message() {
                Ok(m) => m,
                Err(e) => {
                    warn!(upstream = %upstream_id, error = %e, "invalid upstream message");
                    continue;
                }
            };
            self.dispatch_message(&upstream_id, &PeerRole::Router, link_msg)
                .await;
        }

        // Cleanup
        *self.upstream.write().await = None;
        writer_task.abort();

        info!(router = %self.node_id, upstream = %upstream_id, "upstream disconnected");
        Ok(())
    }
}
