//! Minimal OSGP endpoint in Rust.
//!
//! This documentation/example endpoint uses an ordinary WebSocket client crate
//! (`tungstenite`). It imports OSGP wire types from `osgp` instead of defining
//! protocol structs locally.

use osgp::{
    HelloMessage, LinkMessage, ReadOperation, ReadRequest, Role, SessionAddress, SessionEnvelope,
    SessionId,
};
use serde::Serialize;
use serde_json::{json, Value};
use tungstenite::{connect, Message};

fn send_json(
    socket: &mut tungstenite::WebSocket<tungstenite::stream::MaybeTlsStream<std::net::TcpStream>>,
    value: &impl Serialize,
) -> anyhow_like::Result<()> {
    let text = serde_json::to_string(value)?;
    socket.send(Message::Text(text.into()))?;
    Ok(())
}

fn main() -> anyhow_like::Result<()> {
    let router_url =
        std::env::var("OSGP_ROUTER_URL").unwrap_or_else(|_| "ws://127.0.0.1:7200".to_string());
    let source = SessionAddress::new("surface", Some("rust-endpoint".into()), Some("demo".into()));
    let target = SessionAddress::new(
        "domain-a",
        Some("runtime-alpha".into()),
        Some("session-alpha".into()),
    );

    let (mut socket, _) = connect(router_url.as_str())?;

    let hello = HelloMessage {
        node_id: "rust-endpoint-demo".to_string(),
        role: Role::Endpoint,
        addresses: vec![source.clone()],
        capabilities: vec!["surface_viewer".into()],
    };
    send_json(&mut socket, &hello)?;

    let upload = LinkMessage::Envelope(SessionEnvelope::new(
        source.clone(),
        target.clone(),
        "session_update",
        json!({
            "sessionId": "session-alpha",
            "state": "running",
            "title": "Rust OSGP endpoint demo"
        }),
    ));
    send_json(&mut socket, &upload)?;

    let control = LinkMessage::Envelope(SessionEnvelope::new(
        source.clone(),
        target.clone(),
        "control.add_prompt",
        json!({ "text": "Hello from a Rust OSGP endpoint", "role": "user" }),
    ));
    send_json(&mut socket, &control)?;

    let request = LinkMessage::ReadRequest(ReadRequest::new(
        "rust-endpoint-demo",
        target,
        ReadOperation::RuntimeSessionMessages {
            runtime_id: "runtime-alpha".into(),
            session_id: SessionId::new("session-alpha"),
            anchor_time: None,
            limit: Some(20),
            regex: None,
        },
    ));
    send_json(&mut socket, &request)?;

    while let Ok(message) = socket.read() {
        if let Message::Text(text) = message {
            let frame: Value = serde_json::from_str(&text)?;
            println!("received: {}", serde_json::to_string_pretty(&frame)?);
        }
    }

    Ok(())
}

// Tiny local error alias so the example avoids adding anyhow just for docs.
mod anyhow_like {
    pub type Error = Box<dyn std::error::Error + Send + Sync + 'static>;
    pub type Result<T> = std::result::Result<T, Error>;
}
