use anyhow::{bail, Context, Result};
use futures_util::{SinkExt, StreamExt};
use osgp::LinkMessage;
use tokio_tungstenite::{connect_async, tungstenite::Message};

use crate::config::{format_address, Config};

pub type Writer = futures_util::stream::SplitSink<
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    Message,
>;
pub type Reader = futures_util::stream::SplitStream<
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
>;

pub async fn connect_console(config: &Config) -> Result<(Writer, Reader)> {
    let (ws_stream, _) = connect_async(&config.router_url)
        .await
        .with_context(|| format!("failed to connect to {}", config.router_url))?;
    let (mut writer, mut reader) = ws_stream.split();
    let hello = serde_json::json!({
        "nodeId": config.node_id,
        "role": "endpoint",
        "addresses": [config.address],
        "capabilities": ["console", "surface_viewer"],
    });
    writer
        .send(Message::Text(serde_json::to_string(&hello)?.into()))
        .await?;
    if let Ok(Some(Ok(Message::Close(_)))) =
        tokio::time::timeout(std::time::Duration::from_millis(500), reader.next()).await
    {
        bail!("router closed connection during hello");
    }
    Ok((writer, reader))
}

pub async fn send_link(writer: &mut Writer, message: LinkMessage) -> Result<()> {
    writer
        .send(Message::Text(serde_json::to_string(&message)?.into()))
        .await?;
    Ok(())
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
