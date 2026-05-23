use std::sync::Arc;

use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use osgp::{LinkMessage, SessionAddress, SessionEnvelope};
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

    pub async fn send_tool(
        &self,
        channel: &str,
        tool: &str,
        args: Value,
        mutating: bool,
    ) -> Result<()> {
        let link_type = if mutating { "control" } else { "request" };
        let payload =
            json!({ "channel": channel, "tool": tool, "arguments": args, "expect": "response" });
        let mut env =
            SessionEnvelope::new(self.source.clone(), self.target.clone(), link_type, payload);
        env.link_type = link_type.into();
        env.subtype = format!("im_gateway.{}.{}", channel, tool);
        env.validate().map_err(|e| anyhow::anyhow!(e.to_string()))?;
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
    let hello = json!({"nodeId": config.node_id, "role": "endpoint", "addresses": [config.address], "capabilities": ["im_endpoint"]});
    match connect_async(&config.router_url).await {
        Ok((ws, _)) => {
            let (mut writer, mut reader) = ws.split();
            if let Err(error) = writer.send(Message::Text(hello.to_string().into())).await {
                set_error(&status, error.to_string()).await;
                return;
            }
            status.lock().await.connected = true;
            info!(router_url = %config.router_url, address = %format_address(&config.address), "IM endpoint connected to GV router");
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
