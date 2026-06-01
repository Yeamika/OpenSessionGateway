use anyhow::{bail, Context, Result};
use futures_util::{SinkExt, StreamExt};
use osgp::{LinkHandshake, LinkMessage};
use serde_json::json;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::debug;

use crate::admin::{self, AdminRequest, AdminResponse};
use crate::config::{format_address, Config};

pub type Writer = futures_util::stream::SplitSink<
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    Message,
>;
pub type Reader = futures_util::stream::SplitStream<
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
>;

/// Connect to the router using `LinkHandshake` (vNext).
///
/// Declares `surface_viewer` capability via metadata so the router
/// fans out `upload` messages (e.g. `session_update`) to this endpoint.
///
/// Falls back to legacy `HelloMessage` only if the router rejects the
/// new handshake format (detected by close frame within 500ms).
pub async fn connect_console(config: &Config) -> Result<(Writer, Reader)> {
    let (ws_stream, _) = connect_async(&config.router_url)
        .await
        .with_context(|| format!("failed to connect to {}", config.router_url))?;
    let (mut writer, mut reader) = ws_stream.split();

    // Primary: LinkHandshake (vNext) with capabilities in metadata
    let handshake = LinkHandshake::new(&config.node_id).with_metadata(json!({
        "capabilities": ["console", "surface_viewer"],
    }));
    writer
        .send(Message::Text(serde_json::to_string(&handshake)?.into()))
        .await?;

    // Wait briefly for router reply or rejection
    if let Ok(Some(Ok(Message::Close(_)))) =
        tokio::time::timeout(std::time::Duration::from_millis(500), reader.next()).await
    {
        // Router rejected LinkHandshake — fall back to legacy Hello
        debug!("LinkHandshake rejected, falling back to legacy Hello");
        let (ws_stream, _) = connect_async(&config.router_url)
            .await
            .with_context(|| format!("failed to reconnect to {}", config.router_url))?;
        let (mut writer2, mut reader2) = ws_stream.split();
        let hello = serde_json::json!({
            "nodeId": config.node_id,
            "role": "endpoint",
            "addresses": [config.address],
            "capabilities": ["console", "surface_viewer"],
        });
        writer2
            .send(Message::Text(serde_json::to_string(&hello)?.into()))
            .await?;
        if let Ok(Some(Ok(Message::Close(_)))) =
            tokio::time::timeout(std::time::Duration::from_millis(500), reader2.next()).await
        {
            bail!("router closed connection during legacy hello");
        }
        return Ok((writer2, reader2));
    }

    Ok((writer, reader))
}

pub async fn send_link(writer: &mut Writer, message: LinkMessage) -> Result<()> {
    writer
        .send(Message::Text(serde_json::to_string(&message)?.into()))
        .await?;
    Ok(())
}

/// Send an admin request envelope to the router.
pub async fn send_admin_request(
    writer: &mut Writer,
    config: &Config,
    request: &AdminRequest,
) -> Result<()> {
    let envelope = admin::build_admin_request(
        request,
        &config.node_id,
        config.address.clone(),
        config.target.clone(),
    )?;
    send_link(writer, LinkMessage::Envelope(envelope)).await
}

pub async fn handle_ping(writer: &mut Writer) -> Result<()> {
    send_link(writer, LinkMessage::Pong).await
}

pub fn read_link_message(message: Message) -> Option<LinkMessage> {
    let Message::Text(text) = message else {
        return None;
    };
    serde_json::from_str(&text).ok()
}

/// Try to extract an AdminResponse from a LinkMessage.
pub fn extract_admin_response(message: &LinkMessage) -> Option<AdminResponse> {
    match message {
        LinkMessage::Envelope(env) => admin::parse_admin_response(env),
        _ => None,
    }
}

pub fn print_banner(config: &Config) {
    println!("==============================================================");
    println!("  package    : console-endpoint");
    println!("  node_id    : {}", config.node_id);
    println!("  role       : endpoint");
    println!("  address    : {}", format_address(&config.address));
    println!("  router_url : {}", config.router_url);
    println!("  target     : {}", format_address(&config.target));
    println!("  pid        : {}", std::process::id());
    println!("==============================================================");
}
