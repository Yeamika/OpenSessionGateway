use std::sync::Arc;

use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use osgp::{LinkHandshake, LinkMessage, SessionAddress, SessionEnvelope};
use serde_json::{json, Value};
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::{info, warn};

use crate::config::{format_address, Config};

#[derive(Clone)]
pub struct GvClient {
    tx: Option<mpsc::Sender<SessionEnvelope>>,
    status: Arc<Mutex<GvStatus>>,
    source: SessionAddress,
    target: SessionAddress,
    recorded: Arc<Mutex<Vec<SessionEnvelope>>>,
}

#[derive(Clone, Debug, Default, serde::Serialize)]
pub struct GvStatus {
    pub connected: bool,
    pub sent: u64,
    pub received: u64,
    pub last_error: String,
}

impl GvClient {
    pub fn spawn(config: Config) -> Self {
        let (tx, rx) = mpsc::channel(100);
        let status = Arc::new(Mutex::new(GvStatus::default()));
        let recorded = Arc::new(Mutex::new(Vec::new()));
        let client = Self {
            tx: Some(tx),
            status: status.clone(),
            source: config.address.clone(),
            target: config.target.clone(),
            recorded,
        };
        tokio::spawn(run_ws(config, rx, status));
        client
    }

    #[cfg(test)]
    pub fn test() -> Self {
        Self {
            tx: None,
            status: Arc::new(Mutex::new(GvStatus {
                connected: true,
                ..GvStatus::default()
            })),
            source: SessionAddress::new("test", Some("im".into()), Some("source".into())),
            target: SessionAddress::new("test", Some("im".into()), Some("target".into())),
            recorded: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub async fn status(&self) -> GvStatus {
        self.status.lock().await.clone()
    }

    #[cfg(test)]
    pub async fn recorded(&self) -> Vec<SessionEnvelope> {
        self.recorded.lock().await.clone()
    }

    /// Send a `control` / `add_prompt` envelope to the target runtime/session.
    ///
    /// Used when forwarding an IM inbound message to an OSG session.
    /// The `msg` is the user-visible text; `system` carries IM route/chat metadata.
    pub async fn send_add_prompt(
        &self,
        msg: &str,
        system: Option<&str>,
        model: Option<&str>,
    ) -> Result<()> {
        let mut payload = json!({ "text": msg, "role": "user" });
        if let Some(s) = system {
            payload["system"] = json!(s);
        }
        if let Some(m) = model {
            payload["model"] = json!(m);
        }
        let mut env = SessionEnvelope::new(
            self.source.clone(),
            self.target.clone(),
            "control",
            payload,
        );
        env.link_type = "control".into();
        env.subtype = "add_prompt".into();
        env.validate()
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        self.recorded.lock().await.push(env.clone());
        if let Some(tx) = &self.tx {
            tx.send(env).await.context("GV send queue closed")?;
        }
        self.status.lock().await.sent += 1;
        Ok(())
    }

    /// Send a `request` / `runtime_session_messages` envelope to the target.
    ///
    /// Used when the IM endpoint needs to read session messages from a runtime.
    pub async fn send_read_messages(
        &self,
        session_id: &str,
        limit: Option<u32>,
        anchor_time: Option<&str>,
    ) -> Result<()> {
        let mut payload = json!({ "sessionId": session_id });
        if let Some(l) = limit {
            payload["limit"] = json!(l);
        }
        if let Some(a) = anchor_time {
            payload["anchorTime"] = json!(a);
        }
        let mut env = SessionEnvelope::new(
            self.source.clone(),
            self.target.clone(),
            "request",
            payload,
        );
        env.link_type = "request".into();
        env.subtype = "runtime_session_messages".into();
        env.validate()
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        self.recorded.lock().await.push(env.clone());
        if let Some(tx) = &self.tx {
            tx.send(env).await.context("GV send queue closed")?;
        }
        self.status.lock().await.sent += 1;
        Ok(())
    }
}

async fn run_ws(
    config: Config,
    mut rx: mpsc::Receiver<SessionEnvelope>,
    status: Arc<Mutex<GvStatus>>,
) {
    // vNext handshake: LinkHandshake (no legacy role/capabilities)
    let handshake = LinkHandshake::new(&config.node_id)
        .with_metadata(json!({"endpoint":"im-endpoint"}));
    match connect_async(&config.router_url).await {
        Ok((ws, _)) => {
            let (mut writer, mut reader) = ws.split();
            if let Err(error) = writer.send(Message::Text(serde_json::to_string(&handshake).unwrap().into())).await {
                set_error(&status, error.to_string()).await;
                return;
            }
            // Wait for handshake reply before sending Announce
            let _ = reader.next().await;
            status.lock().await.connected = true;
            info!(router_url = %config.router_url, address = %format_address(&config.address), "IM endpoint connected to GV router (LinkHandshake)");
            // Announce source and target addresses
            for addr in [&config.address, &config.target] {
                let announce = LinkMessage::Announce { address: addr.clone(), distance: 0 };
                if let Err(error) = writer.send(Message::Text(serde_json::to_string(&announce).unwrap().into())).await {
                    set_error(&status, error.to_string()).await;
                    break;
                }
                info!(address = %format_address(addr), "announced address to router");
            }
            loop {
                tokio::select! {
                    Some(env) = rx.recv() => {
                        let text = match serde_json::to_string(&LinkMessage::Envelope(env)) { Ok(v) => v, Err(e) => { set_error(&status, e.to_string()).await; continue; } };
                        if let Err(error) = writer.send(Message::Text(text.into())).await { set_error(&status, error.to_string()).await; break; }
                    }
                    msg = reader.next() => match msg {
                        Some(Ok(Message::Text(text))) => handle_incoming(&status, &text).await,
                        Some(Ok(Message::Ping(p))) => { let _ = writer.send(Message::Pong(p)).await; }
                        Some(Ok(Message::Close(_))) | None => break,
                        Some(Ok(_)) => {}
                        Some(Err(error)) => { set_error(&status, error.to_string()).await; break; }
                    }
                }
            }
        }
        Err(error) => set_error(&status, error.to_string()).await,
    }
    status.lock().await.connected = false;
    warn!(router_url = %config.router_url, "IM endpoint GV connection stopped");
}

async fn handle_incoming(status: &Arc<Mutex<GvStatus>>, text: &str) {
    if serde_json::from_str::<LinkMessage>(text).is_ok()
        || serde_json::from_str::<Value>(text).is_ok()
    {
        status.lock().await.received += 1;
    }
}

async fn set_error(status: &Arc<Mutex<GvStatus>>, error: String) {
    status.lock().await.last_error = error;
}
