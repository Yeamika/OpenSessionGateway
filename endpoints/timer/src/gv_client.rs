//! GlassVein WebSocket client
//!
//! Connects to the GV router using `LinkHandshake` (vNext), sends an
//! `Announce` to register the timer endpoint address, and provides
//! methods to send timer trigger envelopes (canonical `control/add_prompt`).

use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::{debug, error, info, warn};

use crate::config::Config;
use crate::osgp_wire;
use crate::timer_store::Timer;

/// Connection state exposed to callers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConnectionState {
    Disconnected,
    Connecting,
    Connected,
}

/// GlassVein WebSocket client.
///
/// Owns the background connection task and provides a channel-based
/// API for sending envelopes.
pub struct GvClient {
    /// Channel to send outbound JSON messages to the writer task.
    tx: mpsc::UnboundedSender<Value>,
    /// Current config (shared with the background task via watch).
    config_tx: watch::Sender<Config>,
    /// Observable connection state.
    state_rx: watch::Receiver<ConnectionState>,
}

impl Clone for GvClient {
    fn clone(&self) -> Self {
        Self {
            tx: self.tx.clone(),
            config_tx: self.config_tx.clone(),
            state_rx: self.state_rx.clone(),
        }
    }
}

impl GvClient {
    /// Create and start the GV client background task.
    pub fn start(config: Config) -> Self {
        let (outbound_tx, outbound_rx) = mpsc::unbounded_channel::<Value>();
        let (config_tx, config_rx) = watch::channel(config.clone());
        let (state_tx, state_rx) = watch::channel(ConnectionState::Disconnected);

        // Spawn background connection manager
        tokio::spawn(connection_task(config_rx, outbound_rx, state_tx));

        Self {
            tx: outbound_tx,
            config_tx,
            state_rx,
        }
    }

    /// Get the current connection state.
    pub fn state(&self) -> ConnectionState {
        self.state_rx.borrow().clone()
    }

    /// Send a timer trigger envelope to the router (canonical `control/add_prompt`).
    pub fn send_timer_trigger(&self, timer: &Timer) -> Result<()> {
        let config = self.config_tx.borrow().clone();
        let envelope = osgp_wire::create_timer_trigger_envelope(&config, timer);
        self.tx
            .send(envelope)
            .map_err(|_| anyhow::anyhow!("GV client channel closed"))?;
        Ok(())
    }
}

/// Background task that manages the WebSocket connection lifecycle.
///
/// Reconnects automatically on disconnect. Watches for config changes
/// and reconnects if the router URL changes.
async fn connection_task(
    mut config_rx: watch::Receiver<Config>,
    mut outbound_rx: mpsc::UnboundedReceiver<Value>,
    state_tx: watch::Sender<ConnectionState>,
) {
    loop {
        let config = config_rx.borrow().clone();

        let router_url = match &config.gv.router_url {
            Some(url) => url.clone(),
            None => {
                // No router URL configured — idle
                let _ = state_tx.send(ConnectionState::Disconnected);
                // Wait for config change
                if config_rx.changed().await.is_err() {
                    break;
                }
                continue;
            }
        };

        // Attempt connection
        let _ = state_tx.send(ConnectionState::Connecting);
        info!(url = %router_url, "connecting to GV router");

        match connect_and_run(
            &config,
            &router_url,
            &mut config_rx,
            &mut outbound_rx,
            &state_tx,
        )
        .await
        {
            Ok(()) => {
                // Clean exit (config changed, trigger reconnect)
                debug!("connection task: reconnecting due to config change");
            }
            Err(e) => {
                warn!(error = %e, "connection lost");
                let _ = state_tx.send(ConnectionState::Disconnected);
                // Backoff before retry
                tokio::select! {
                    _ = tokio::time::sleep(std::time::Duration::from_secs(3)) => {}
                    _ = config_rx.changed() => {}
                }
            }
        }
    }
}

/// Connect to the router and run the read/write loop.
///
/// Returns Ok(()) when config changes require a reconnect, or Err on
/// connection failure.
async fn connect_and_run(
    config: &Config,
    router_url: &str,
    config_rx: &mut watch::Receiver<Config>,
    outbound_rx: &mut mpsc::UnboundedReceiver<Value>,
    state_tx: &watch::Sender<ConnectionState>,
) -> Result<()> {
    let (ws_stream, _) = connect_async(router_url)
        .await
        .with_context(|| format!("failed to connect to {router_url}"))?;
    let (mut writer, mut reader) = ws_stream.split();

    // ── Step 1: LinkHandshake ────────────────────────────────────────
    let handshake = osgp_wire::create_link_handshake(config);
    writer
        .send(Message::Text(serde_json::to_string(&handshake)?.into()))
        .await
        .context("send LinkHandshake")?;

    // Wait briefly for router reply or rejection
    let handshake_result =
        tokio::time::timeout(std::time::Duration::from_millis(2000), reader.next()).await;

    match handshake_result {
        Ok(Some(Ok(Message::Close(_)))) => {
            // LinkHandshake rejected — try legacy Hello
            warn!("LinkHandshake rejected, falling back to legacy Hello");
            let (ws_stream, _) = connect_async(router_url)
                .await
                .with_context(|| format!("failed to reconnect to {router_url}"))?;
            let (mut writer2, mut reader2) = ws_stream.split();
            #[allow(deprecated)]
            let hello = osgp_wire::create_hello_envelope(config);
            writer2
                .send(Message::Text(serde_json::to_string(&hello)?.into()))
                .await
                .context("send legacy Hello")?;
            if let Ok(Some(Ok(Message::Close(_)))) =
                tokio::time::timeout(std::time::Duration::from_millis(500), reader2.next()).await
            {
                anyhow::bail!("router closed connection during legacy hello");
            }
            // Use the legacy connection
            writer = writer2;
            reader = reader2;
        }
        Ok(Some(Ok(Message::Text(text)))) => {
            // Got a reply (e.g., Hello reply from router) — good
            debug!(frame = %text, "received handshake reply");
        }
        Ok(Some(Ok(Message::Ping(data)))) => {
            writer.send(Message::Pong(data)).await.ok();
        }
        Ok(Some(Ok(other))) => {
            debug!(?other, "unexpected frame during handshake");
        }
        Ok(Some(Err(e))) => {
            anyhow::bail!("error during handshake: {e}");
        }
        Ok(None) => {
            anyhow::bail!("connection closed during handshake");
        }
        Err(_) => {
            // Timeout — no reply within 2s, but connection is still open.
            // This is fine; the router may not send an explicit reply.
            debug!("no handshake reply within timeout (continuing)");
        }
    }

    // ── Step 2: Announce address ─────────────────────────────────────
    let announce = osgp_wire::create_announce(config);
    writer
        .send(Message::Text(serde_json::to_string(&announce)?.into()))
        .await
        .context("send Announce")?;
    info!("sent Announce for timer endpoint address");

    let _ = state_tx.send(ConnectionState::Connected);
    info!("connected to GV router");

    // ── Step 3: Read/write loop ──────────────────────────────────────
    loop {
        tokio::select! {
            // Inbound frames from router
            frame = reader.next() => {
                match frame {
                    Some(Ok(Message::Text(text))) => {
                        handle_inbound_text(&text, &mut writer).await;
                    }
                    Some(Ok(Message::Ping(data))) if writer.send(Message::Pong(data.clone())).await.is_err() => break,
                    Some(Ok(Message::Ping(_))) => {}
                    Some(Ok(Message::Pong(_))) => { /* ignore */ }
                    Some(Ok(Message::Close(_))) => {
                        info!("router closed connection");
                        break;
                    }
                    Some(Err(e)) => {
                        error!(error = %e, "WebSocket read error");
                        break;
                    }
                    None => {
                        info!("WebSocket stream ended");
                        break;
                    }
                    _ => { /* binary frames ignored */ }
                }
            }
            // Outbound messages from timer logic
            Some(msg) = outbound_rx.recv() => {
                let text = serde_json::to_string(&msg).unwrap_or_default();
                if writer.send(Message::Text(text.into())).await.is_err() {
                    error!("failed to send outbound message");
                    break;
                }
            }
            // Config change → check if router URL changed
            _ = config_rx.changed() => {
                let new_config = config_rx.borrow().clone();
                if new_config.gv.router_url.as_deref() != Some(router_url) {
                    info!("router URL changed, reconnecting");
                    return Ok(());
                }
            }
        }
    }

    Ok(())
}

/// Handle an inbound text frame from the router.
async fn handle_inbound_text(
    text: &str,
    writer: &mut futures_util::stream::SplitSink<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        Message,
    >,
) {
    // Try to parse as a generic JSON value first
    let value: Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(e) => {
            warn!(error = %e, "invalid JSON from router");
            return;
        }
    };

    // Handle ping
    if value.get("type").and_then(|v| v.as_str()) == Some("ping") {
        let pong = serde_json::json!({ "type": "pong" });
        let _ = writer
            .send(Message::Text(
                serde_json::to_string(&pong).unwrap_or_default().into(),
            ))
            .await;
        return;
    }

    // Log envelope messages
    if value.get("type").and_then(|v| v.as_str()) == Some("envelope") {
        let subtype = value
            .get("subtype")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        debug!(subtype = %subtype, "received envelope from router");
    }

    // Log other messages at debug level
    debug!(frame = %text, "received message from router");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::default_config;

    #[test]
    fn test_connection_state_variants() {
        assert_ne!(ConnectionState::Disconnected, ConnectionState::Connected);
        assert_ne!(ConnectionState::Connecting, ConnectionState::Connected);
    }

    #[tokio::test]
    async fn test_gv_client_start_and_state() {
        let mut config = default_config();
        // Use an unreachable address (TEST-NET-1, RFC 5737) so the test never
        // accidentally succeeds when a real router is running on localhost.
        config.gv.router_url = Some("ws://192.0.2.1:1".to_string());
        let client = GvClient::start(config);
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        // Must be Connecting or Disconnected — never Connected
        let state = client.state();
        assert!(
            state == ConnectionState::Connecting || state == ConnectionState::Disconnected,
            "unexpected state: {:?}",
            state
        );
    }

    #[tokio::test]
    async fn test_gv_client_no_router_url() {
        let mut config = default_config();
        config.gv.router_url = None;
        let client = GvClient::start(config);
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert_eq!(client.state(), ConnectionState::Disconnected);
    }

    #[test]
    fn test_send_timer_trigger_on_closed_channel() {
        let config = default_config();
        let (outbound_tx, outbound_rx) = mpsc::unbounded_channel::<Value>();
        let (config_tx, config_rx) = watch::channel(config.clone());
        let (state_tx, state_rx) = watch::channel(ConnectionState::Disconnected);

        // Drop the receiver to close the channel
        drop(outbound_rx);
        drop(config_rx);
        drop(state_tx);

        let client = GvClient {
            tx: outbound_tx,
            config_tx,
            state_rx,
        };

        // Creating a dummy timer for the test
        let timer = crate::timer_store::Timer {
            timer_id: "timer-test-123".to_string(),
            runtime_id: "test".into(),
            session_id: "test".into(),
            executor_runtime_id: "exec".into(),
            executor_session_id: "exec-ses".into(),
            title: "test".into(),
            msg: "test".into(),
            timer_type: crate::timer_store::TimerType::OneShot,
            delay_seconds: 1,
            every_seconds: None,
            cron_expr: None,
            created_at: "2026-01-01T00:00:00Z".into(),
            trigger_at: "2026-01-01T00:00:01Z".into(),
            status: crate::timer_store::TimerStatus::Pending,
        };

        let result = client.send_timer_trigger(&timer);
        assert!(result.is_err(), "should fail on closed channel");
    }
}
