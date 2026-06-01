use crate::state::{EndpointConfig, SharedState};
use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use osgp::{Envelope, LinkHandshake, LinkMessage, LinkType, Payload, RouteTarget, SessionAddress};
use serde_json::{json, Value};
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[derive(Clone)]
pub struct GvClient {
    state: SharedState,
    tx: std::sync::Arc<tokio::sync::Mutex<Option<mpsc::UnboundedSender<ClientCommand>>>>,
}

#[derive(Debug)]
enum ClientCommand {
    Send(Envelope),
    Stop,
}

impl GvClient {
    pub fn new(state: SharedState) -> Self {
        Self {
            state,
            tx: Default::default(),
        }
    }

    pub async fn connect(&self, config: EndpointConfig) -> Result<()> {
        self.disconnect().await;
        self.state.set_config(config.clone()).await;
        self.state.set_status("connecting", "").await;
        let (tx, rx) = mpsc::unbounded_channel();
        *self.tx.lock().await = Some(tx);
        let state = self.state.clone();
        tokio::spawn(async move {
            if let Err(error) = run_connection(config, state.clone(), rx).await {
                state.set_status("disconnected", error.to_string()).await;
                state
                    .log("gv_error", json!({ "message": error.to_string() }))
                    .await;
            }
        });
        Ok(())
    }

    pub async fn disconnect(&self) {
        if let Some(tx) = self.tx.lock().await.take() {
            let _ = tx.send(ClientCommand::Stop);
        }
        self.state.set_status("disconnected", "").await;
    }

    pub async fn send(&self, link_type: &str, subtype: &str, payload: Value) -> Result<String> {
        let snapshot = self.state.snapshot().await;
        let config = snapshot
            .config
            .context("connect before sending GV envelopes")?;
        let envelope = make_envelope(&config.source, &config.target, link_type, subtype, payload);
        let id = envelope.message_id.clone();
        let tx = self
            .tx
            .lock()
            .await
            .clone()
            .context("GV connection is not active")?;
        tx.send(ClientCommand::Send(envelope))?;
        Ok(id)
    }
}

async fn run_connection(
    config: EndpointConfig,
    state: SharedState,
    mut rx: mpsc::UnboundedReceiver<ClientCommand>,
) -> Result<()> {
    let (ws, _) = connect_async(&config.router_url)
        .await
        .with_context(|| format!("connect {}", config.router_url))?;
    let (mut writer, mut reader) = ws.split();

    // Use osgp::LinkHandshake (camelCase, protocolVersion "osgp/1").
    let source_json = serde_json::to_value(&config.source)
        .unwrap_or(json!(config.source.domain));
    let handshake = LinkHandshake::new(&config.node_id)
        .with_metadata(json!({
            "endpoint": "session-control",
            "source": source_json,
        }));
    writer
        .send(Message::Text(serde_json::to_string(&handshake).unwrap_or_default().into()))
        .await?;

    // Wait for handshake reply from router.
    // Router replies with a legacy HelloMessage: {"nodeId":"...","role":"router",...}
    // We accept any valid JSON reply that contains a nodeId as a successful ack.
    let ack_frame = reader
        .next()
        .await
        .context("no handshake reply from router")?
        .context("websocket error waiting for reply")?;
    let ack_text = ack_frame
        .to_text()
        .context("non-text reply frame")?;
    let ack_json: Value = serde_json::from_str(ack_text)
        .context("invalid JSON in handshake reply")?;
    // Accept if reply has "nodeId" (HelloMessage) or "success" (LinkHandshakeAck)
    let has_node_id = ack_json.get("nodeId").and_then(Value::as_str).is_some();
    let is_success_ack = ack_json.get("success").and_then(Value::as_bool).unwrap_or(false);
    if !has_node_id && !is_success_ack {
        let error_msg = ack_json
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        anyhow::bail!("handshake rejected by router: {}", error_msg);
    }
    let router_node_id = ack_json
        .get("nodeId")
        .and_then(Value::as_str)
        .unwrap_or("unknown");

    state.set_status("connected", "").await;
    state
        .log(
            "gv_connected",
            json!({ "routerUrl": config.router_url, "routerNodeId": router_node_id }),
        )
        .await;

    loop {
        tokio::select! {
            Some(command) = rx.recv() => match command {
                ClientCommand::Send(envelope) => {
                    let label = format!("sent {:?}/{}", envelope.link_type, envelope.subtype);
                    let frame = serde_json::to_string(&LinkMessage::TypedEnvelope(envelope.clone()))?;
                    writer.send(Message::Text(frame.into())).await?;
                    state.log(label, serde_json::to_value(&envelope.payload)?).await;
                }
                ClientCommand::Stop => break,
            },
            message = reader.next() => match message {
                Some(Ok(Message::Text(text))) => handle_text(&state, &text).await?,
                Some(Ok(Message::Close(_))) | None => break,
                Some(Ok(_)) => {}
                Some(Err(error)) => return Err(error.into()),
            }
        }
    }
    state.set_status("disconnected", "").await;
    Ok(())
}

async fn handle_text(state: &SharedState, text: &str) -> Result<()> {
    let msg: LinkMessage = serde_json::from_str(text)?;
    match msg {
        LinkMessage::Envelope(_) => {
            state
                .log(
                    "compat_envelope_ignored",
                    json!({ "reason": "canonical_typed_only" }),
                )
                .await;
        }
        LinkMessage::TypedEnvelope(envelope) => {
            let payload = serde_json::to_value(envelope.payload)?;
            if envelope.link_type == osgp::LinkType::Upload && envelope.subtype == "session_update"
            {
                state.session_update(payload).await;
            } else if envelope.link_type == osgp::LinkType::Response {
                state
                    .log(format!("response {}", envelope.subtype), payload)
                    .await;
            }
        }
        LinkMessage::Ping => state.log("ping", json!({})).await,
        _ => state.log("gv_frame", serde_json::to_value(msg)?).await,
    }
    Ok(())
}

fn make_envelope(
    source: &SessionAddress,
    target: &SessionAddress,
    link_type: &str,
    subtype: &str,
    payload: Value,
) -> Envelope {
    Envelope {
        message_id: uuid::Uuid::new_v4().to_string(),
        source: RouteTarget::address(source.clone()),
        target: RouteTarget::address(target.clone()),
        payload: Payload::Text(json!({ "subtype": subtype, "body": payload })),
        link_type: parse_link_type(link_type),
        subtype: subtype.into(),
        route_hops: Vec::new(),
    }
}

fn parse_link_type(value: &str) -> LinkType {
    match value {
        "control" => LinkType::Control,
        "request" => LinkType::Request,
        "response" => LinkType::Response,
        _ => LinkType::Upload,
    }
}
