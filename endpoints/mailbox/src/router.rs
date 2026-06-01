//! Router connection for the mailbox endpoint.
//!
//! Connects to a GlassVein router via WebSocket, performs a `LinkHandshake`,
//! and optionally announces the mailbox address so other endpoints can
//! reach it through the router.
//!
//! ## Permission requirements
//!
//! The router must have a persistent grant for this peer with at least:
//! - `announce.route` — to register the mailbox address
//!
//! Additional grants may be needed depending on usage:
//! - `read.runtime_session_messages` — to read session messages via the router
//! - `admin.routes.read` — to query the router's route table
//!
//! No admin write permissions are required.

use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use osgp::{LinkHandshake, LinkMessage, SessionAddress};
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::{debug, error, info, warn};

/// Configuration for connecting to a router.
#[derive(Debug, Clone)]
pub struct RouterConnConfig {
    /// WebSocket URL of the router (e.g. "ws://127.0.0.1:7200").
    pub router_url: String,
    /// Peer ID to use in the LinkHandshake.
    pub peer_id: String,
    /// Addresses to announce after handshake (optional).
    pub announce_addresses: Vec<SessionAddress>,
}

/// Status of the router connection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RouterStatus {
    Disconnected,
    Connecting,
    Connected,
    Error(String),
}

/// Handle for the background router connection task.
#[derive(Debug)]
pub struct RouterHandle {
    /// Current connection status.
    pub status_rx: watch::Receiver<RouterStatus>,
    /// Channel to send LinkMessages to the router.
    pub tx: mpsc::UnboundedSender<LinkMessage>,
    /// Peer ID used in the handshake.
    pub peer_id: String,
}

/// Connect to the router in a background task.
///
/// Returns a `RouterHandle` that can be used to send messages and check status.
/// The background task will:
/// 1. Connect via WebSocket
/// 2. Send a `LinkHandshake` as the first frame
/// 3. Read the router's reply
/// 4. Announce configured addresses
/// 5. Enter a read loop, forwarding incoming messages to the provided channel
pub async fn connect_router(
    config: RouterConnConfig,
    incoming_tx: mpsc::UnboundedSender<LinkMessage>,
) -> Result<RouterHandle> {
    let (status_tx, status_rx) = watch::channel(RouterStatus::Disconnected);
    let (outgoing_tx, mut outgoing_rx) = mpsc::unbounded_channel::<LinkMessage>();
    let peer_id = config.peer_id.clone();

    let handle = RouterHandle {
        status_rx,
        tx: outgoing_tx,
        peer_id: peer_id.clone(),
    };

    tokio::spawn(async move {
        loop {
            let _ = status_tx.send(RouterStatus::Connecting);
            match run_connection(&config, &status_tx, &incoming_tx, &mut outgoing_rx).await {
                Ok(()) => {
                    info!(peer = %config.peer_id, "router connection closed normally");
                    let _ = status_tx.send(RouterStatus::Disconnected);
                }
                Err(e) => {
                    warn!(peer = %config.peer_id, error = %e, "router connection error");
                    let _ = status_tx.send(RouterStatus::Error(e.to_string()));
                }
            }
            // Wait before reconnecting
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            info!(peer = %config.peer_id, "reconnecting to router...");
        }
    });

    Ok(handle)
}

/// Run a single connection lifecycle.
async fn run_connection(
    config: &RouterConnConfig,
    status_tx: &watch::Sender<RouterStatus>,
    incoming_tx: &mpsc::UnboundedSender<LinkMessage>,
    outgoing_rx: &mut mpsc::UnboundedReceiver<LinkMessage>,
) -> Result<()> {
    let (ws_stream, _) = connect_async(&config.router_url)
        .await
        .with_context(|| format!("WebSocket connect to {}", config.router_url))?;

    let (mut writer, mut reader) = ws_stream.split();

    // Step 1: Send LinkHandshake
    let handshake = LinkHandshake::new(&config.peer_id);
    let handshake_json = serde_json::to_string(&handshake)?;
    writer
        .send(Message::Text(handshake_json.into()))
        .await
        .context("send LinkHandshake")?;

    info!(peer = %config.peer_id, router = %config.router_url, "LinkHandshake sent");

    // Step 2: Read router reply (HelloMessage or LinkHandshake)
    let reply = tokio::time::timeout(std::time::Duration::from_secs(5), reader.next())
        .await
        .context("timeout waiting for router reply")?
        .context("no router reply")??;

    match reply {
        Message::Text(text) => {
            // Try to parse as any handshake kind
            match serde_json::from_str::<osgp::HandshakeKind>(&text) {
                Ok(osgp::HandshakeKind::Link(hs)) => {
                    info!(
                        peer = %config.peer_id,
                        router_peer = %hs.peer_id,
                        protocol = %hs.protocol_version,
                        "router accepted LinkHandshake"
                    );
                }
                #[allow(deprecated)]
                Ok(osgp::HandshakeKind::Hello(hello)) => {
                    info!(
                        peer = %config.peer_id,
                        router_node = %hello.node_id,
                        "router replied with legacy HelloMessage"
                    );
                }
                Err(e) => {
                    warn!(error = %e, reply = %text, "unexpected router reply");
                }
            }
        }
        Message::Close(_) => {
            anyhow::bail!("router closed connection during handshake");
        }
        other => {
            warn!(?other, "unexpected message type during handshake");
        }
    }

    let _ = status_tx.send(RouterStatus::Connected);

    // Step 3: Announce addresses
    for addr in &config.announce_addresses {
        let msg = LinkMessage::Announce {
            address: addr.clone(),
            distance: 0,
        };
        let json = serde_json::to_string(&msg)?;
        writer.send(Message::Text(json.into())).await?;
        info!(peer = %config.peer_id, address = %format_addr(addr), "announced route");
    }

    // Step 4: Read/write loop
    loop {
        tokio::select! {
            // Incoming from router
            frame = reader.next() => {
                match frame {
                    Some(Ok(Message::Text(text))) => {
                        match serde_json::from_str::<LinkMessage>(&text) {
                            Ok(LinkMessage::Ping) => {
                                let pong = serde_json::to_string(&LinkMessage::Pong)?;
                                writer.send(Message::Text(pong.into())).await?;
                                debug!(peer = %config.peer_id, "pong sent");
                            }
                            Ok(msg) => {
                                debug!(peer = %config.peer_id, "received message");
                                if incoming_tx.send(msg).is_err() {
                                    break;
                                }
                            }
                            Err(_) => {
                                // Might be a raw handshake or non-LinkMessage text
                                debug!(peer = %config.peer_id, "non-LinkMessage text ignored");
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) => {
                        info!(peer = %config.peer_id, "router closed connection");
                        break;
                    }
                    Some(Err(e)) => {
                        error!(peer = %config.peer_id, error = %e, "WebSocket read error");
                        break;
                    }
                    None => {
                        info!(peer = %config.peer_id, "WebSocket stream ended");
                        break;
                    }
                    _ => {}
                }
            }
            // Outgoing to router
            msg = outgoing_rx.recv() => {
                match msg {
                    Some(msg) => {
                        let json = serde_json::to_string(&msg)?;
                        if writer.send(Message::Text(json.into())).await.is_err() {
                            error!(peer = %config.peer_id, "WebSocket write failed");
                            break;
                        }
                    }
                    None => break,
                }
            }
        }
    }

    Ok(())
}

fn format_addr(addr: &SessionAddress) -> String {
    match (&addr.runtime, &addr.session) {
        (Some(rt), Some(ses)) => format!("{}/{}/{}", addr.domain, rt, ses),
        (Some(rt), None) => format!("{}/{}/*", addr.domain, rt),
        (None, Some(ses)) => format!("{}/*/{}", addr.domain, ses),
        (None, None) => format!("{}/*/*", addr.domain),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn router_conn_config_clone() {
        let config = RouterConnConfig {
            router_url: "ws://127.0.0.1:7200".into(),
            peer_id: "mailbox-endpoint".into(),
            announce_addresses: vec![],
        };
        let cloned = config.clone();
        assert_eq!(cloned.router_url, "ws://127.0.0.1:7200");
        assert_eq!(cloned.peer_id, "mailbox-endpoint");
    }

    #[test]
    fn router_status_equality() {
        assert_eq!(RouterStatus::Disconnected, RouterStatus::Disconnected);
        assert_eq!(RouterStatus::Connected, RouterStatus::Connected);
        assert_ne!(RouterStatus::Connected, RouterStatus::Disconnected);
    }

    #[test]
    fn link_handshake_format() {
        let hs = LinkHandshake::new("mailbox-endpoint");
        assert_eq!(hs.protocol_version, "osgp/1");
        assert_eq!(hs.peer_id, "mailbox-endpoint");
        let json = serde_json::to_string(&hs).unwrap();
        assert!(json.contains("peerId"));
        assert!(json.contains("protocolVersion"));
    }

    #[test]
    fn announce_message_format() {
        let addr = SessionAddress::new("mailbox", None, None);
        let msg = LinkMessage::Announce {
            address: addr,
            distance: 0,
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("announce"));
        assert!(json.contains("mailbox"));
    }
}
