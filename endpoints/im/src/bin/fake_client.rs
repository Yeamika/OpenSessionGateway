use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use osgp::{LinkHandshake, LinkMessage};
use serde_json::json;
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .with_target(false)
        .init();
    let router_url = arg("--router-url", "ws://127.0.0.1:7200");
    let node_id = arg("--node-id", "im-fake-client");
    let address = arg("--address", "domain-a/im-backend/session");
    let session_addr = parse_addr(&address)?;
    // vNext handshake: LinkHandshake (no legacy role/capabilities)
    let handshake = LinkHandshake::new(&node_id)
        .with_metadata(json!({"endpoint":"im-fake-client"}));
    let (ws, _) = connect_async(&router_url)
        .await
        .with_context(|| format!("connect {router_url}"))?;
    let (mut writer, mut reader) = ws.split();
    writer.send(Message::Text(serde_json::to_string(&handshake)?.into())).await?;
    // Wait for handshake reply
    if let Some(Ok(msg)) = reader.next().await {
        if let Message::Text(text) = &msg {
            println!("fake-client handshake-reply: {text}");
        }
    }
    // Announce address
    let announce = LinkMessage::Announce { address: session_addr, distance: 0 };
    writer.send(Message::Text(serde_json::to_string(&announce)?.into())).await?;
    println!("fake-client connected router={router_url} address={address} (LinkHandshake)");
    while let Some(msg) = reader.next().await {
        let msg = msg?;
        match msg {
            Message::Text(text) => {
                if let Ok(LinkMessage::Envelope(env)) = serde_json::from_str::<LinkMessage>(&text) {
                    println!(
                        "fake-client received type={} subtype={}",
                        env.link_type, env.subtype
                    );
                    let response = osgp::SessionEnvelope::new(
                        env.target,
                        env.source,
                        "response",
                        json!({"ok":true,"echoSubtype":env.subtype,"received":env.payload}),
                    );
                    writer
                        .send(Message::Text(
                            serde_json::to_string(&LinkMessage::Envelope(response))?.into(),
                        ))
                        .await?;
                } else if text.contains("nodeId") {
                    println!("fake-client hello-reply {text}");
                }
            }
            Message::Ping(p) => writer.send(Message::Pong(p)).await?,
            Message::Close(_) => break,
            _ => {}
        }
    }
    Ok(())
}

fn arg(flag: &str, fallback: &str) -> String {
    let mut args = std::env::args().skip(1);
    while let Some(item) = args.next() {
        if item == flag {
            return args.next().unwrap_or_else(|| fallback.into());
        }
    }
    fallback.into()
}

fn parse_addr(value: &str) -> Result<osgp::SessionAddress> {
    let mut parts = value.split('/');
    let domain = parts.next().context("domain")?;
    let runtime = parts.next().map(str::to_string);
    let session = parts.next().map(str::to_string);
    Ok(osgp::SessionAddress::new(domain, runtime, session))
}
