use crate::{gv_client::GvClient, state::EndpointConfig};
use anyhow::{bail, Result};
use osgp::SessionAddress;
use serde::Deserialize;
use serde_json::{json, Value};

const REQUESTS: &[&str] = &["runtime_session_view_snapshot", "runtime_session_messages"];
const CONTROLS: &[&str] = &[
    "add_prompt",
    "abort_session",
    "compact_session",
    "create_session",
    "rename_session",
    "resume_session",
];

#[derive(Debug, Deserialize)]
pub struct ConnectBody {
    pub router_url: String,
    pub node_id: String,
    pub source: AddressBody,
    pub target: AddressBody,
}

#[derive(Debug, Deserialize)]
pub struct AddressBody {
    pub domain: String,
    pub runtime: Option<String>,
    pub session: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SendBody {
    pub subtype: String,
    #[serde(default)]
    pub payload: Value,
}

pub async fn connect(gv: &GvClient, body: &[u8]) -> Result<Value> {
    let body: ConnectBody = serde_json::from_slice(body)?;
    let config = EndpointConfig {
        router_url: required(body.router_url, "router_url")?,
        node_id: required(body.node_id, "node_id")?,
        source: address(body.source)?,
        target: address(body.target)?,
    };
    gv.connect(config).await?;
    Ok(json!({ "ok": true }))
}

pub async fn disconnect(gv: &GvClient) -> Result<Value> {
    gv.disconnect().await;
    Ok(json!({ "ok": true }))
}

pub async fn request(gv: &GvClient, body: &[u8]) -> Result<Value> {
    let body = send_body(body, REQUESTS)?;
    let id = gv.send("request", &body.subtype, body.payload).await?;
    Ok(json!({ "ok": true, "messageId": id }))
}

pub async fn control(gv: &GvClient, body: &[u8]) -> Result<Value> {
    let body = send_body(body, CONTROLS)?;
    let id = gv.send("control", &body.subtype, body.payload).await?;
    Ok(json!({ "ok": true, "messageId": id }))
}

fn send_body(body: &[u8], allowed: &[&str]) -> Result<SendBody> {
    let body: SendBody = serde_json::from_slice(body)?;
    if !allowed.contains(&body.subtype.as_str()) {
        bail!("unsupported subtype '{}'", body.subtype);
    }
    Ok(body)
}

fn address(body: AddressBody) -> Result<SessionAddress> {
    let address = SessionAddress::new(
        required(body.domain, "address.domain")?,
        body.runtime.filter(|v| !v.trim().is_empty()),
        body.session.filter(|v| !v.trim().is_empty()),
    );
    address
        .validate()
        .map_err(|error| anyhow::anyhow!(error.to_string()))?;
    Ok(address)
}

fn required(value: String, field: &str) -> Result<String> {
    let value = value.trim().to_string();
    if value.is_empty() {
        bail!("{field} is required");
    }
    Ok(value)
}
