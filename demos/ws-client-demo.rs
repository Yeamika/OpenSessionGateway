//! Real WebSocket client demo.
//!
//! This demo connects to a running GlassVein router via WebSocket,
//! registers its identity, and sends a SessionUpdate payload.
//!
//! Usage:
//!   cargo run -p glassvein-demos --bin ws-client-demo -- --router-url ws://127.0.0.1:7100
//!
//! Prerequisites:
//!   Start a router first: cargo run -p router -- --bind 127.0.0.1:7100

use std::env;

use anyhow::{bail, Context, Result};
use osgp_client::{ClientConfig, ClientIdentity, WebSocketTransportHandle};
use osgp::{Payload, RouteTarget, SessionAddress, SessionState, SessionUpdate};
use tokio::time::Duration;
use tracing::info;

/// Send a Hello handshake to the router before any LinkMessage traffic.
///
/// The router expects the first WebSocket message to be a `HelloMessage` JSON
/// (not a `LinkMessage`). After sending Hello, we drain any pending raw text
/// (router Hello reply, if any) to clear the out-of-band buffer before
/// proceeding with normal LinkMessage traffic.
async fn send_hello_handshake(
    transport: &WebSocketTransportHandle,
    node_id: &str,
    address: &SessionAddress,
) -> Result<()> {
    // Send Hello as raw JSON (not a LinkMessage)
    let hello = serde_json::json!({
        "nodeId": node_id,
        "role": "endpoint",
        "addresses": [address],
        "capabilities": [],
    });
    let hello_text = serde_json::to_string(&hello)?;
    transport.send_raw_text(&hello_text).await?;
    info!(node_id = %node_id, "sent Hello handshake");

    // Give the router a moment to process Hello and potentially send a reply.
    // Most routers do NOT send a Hello reply on downstream connections,
    // so we just drain any pending raw text with a short timeout.
    match tokio::time::timeout(Duration::from_millis(500), transport.receive_raw_text()).await {
        Ok(Ok(Some(reply_text))) => {
            info!(reply = %reply_text, "received router Hello reply");
        }
        _ => {
            // No reply or timeout — this is normal for downstream connections.
            info!("no Hello reply from router (normal for downstream)");
        }
    }

    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    let args = parse_args()?;

    println!("═══════════════════════════════════════════════════════════");
    println!("  GlassVein WebSocket Client Demo");
    println!("═══════════════════════════════════════════════════════════");
    println!("  node_id    : {}", args.node_id);
    println!("  router_url : {}", args.router_url);
    println!("  address    : {}", format_address(&args.address));
    println!();

    // Step 1: Connect to router via WebSocket
    println!("[1/5] Connecting to router at {}...", args.router_url);
    let transport = WebSocketTransportHandle::connect(&args.router_url)
        .await
        .context("failed to connect to router")?;
    println!("  ✓ WebSocket connected");

    // Step 2: Send Hello handshake (router requires Hello before LinkMessages)
    println!("[2/5] Sending Hello handshake...");
    send_hello_handshake(&transport, &args.node_id, &args.address).await?;
    println!("  ✓ Hello handshake complete");

    // Step 3: Create client
    let config = ClientConfig {
        identity: ClientIdentity {
            node_id: args.node_id.clone(),
            address: args.address.clone(),
        },
        auto_reply: false,
    };
    let mut client = osgp_client::Client::new(config, transport);
    println!("  ✓ Client created");

    // Step 4: Connect and register (sends Announce LinkMessage)
    println!("[3/5] Registering with router...");
    client.connect().await?;
    client.register().await?;
    println!("  ✓ Registered as {}", args.address.domain);

    // Step 5: Send a SessionUpdate
    println!("[4/5] Sending SessionUpdate...");
    let session_id = args
        .address
        .session
        .clone()
        .unwrap_or_else(|| "default".to_string());

    let payload = Payload::SessionUpdate(SessionUpdate {
        session_id: session_id.clone().into(),
        state: SessionState::Running,
        title: Some("WS Demo Session".to_string()),
        summary: Some("Connected via real WebSocket transport".to_string()),
        metadata: Some(serde_json::json!({
            "transport": "websocket",
            "node_id": args.node_id,
            "timestamp": chrono_timestamp(),
        })),
    });

    // Send to ourselves (loopback) or to a target
    let target = if let Some(target_addr) = args.target {
        RouteTarget::address(target_addr)
    } else {
        RouteTarget::address(args.address.clone())
    };

    let message_id = client.send(target, payload).await?;
    println!("  ✓ SessionUpdate sent (message_id: {})", message_id);

    // Step 6: Wait for response or timeout
    println!("[5/5] Waiting for messages (5s timeout)...");
    match tokio::time::timeout(Duration::from_secs(5), client.receive()).await {
        Ok(Ok(Some(envelope))) => {
            println!("  ✓ Received envelope:");
            println!("    message_id : {}", envelope.message_id);
            println!("    type       : {:?}", envelope.link_type);
            println!("    subtype    : {}", envelope.subtype);
            println!("    source     : {:?}", envelope.source);
            println!("    target     : {:?}", envelope.target);
        }
        Ok(Ok(None)) => {
            println!("  ⚠ Connection closed");
        }
        Ok(Err(e)) => {
            println!("  ✗ Receive error: {}", e);
        }
        Err(_) => {
            println!("  ⏱ Timeout (no response received)");
        }
    }

    println!();
    println!("═══════════════════════════════════════════════════════════");
    println!("  Demo complete");
    println!("═══════════════════════════════════════════════════════════");

    Ok(())
}

struct Args {
    node_id: String,
    router_url: String,
    address: SessionAddress,
    target: Option<SessionAddress>,
}

fn parse_args() -> Result<Args> {
    let mut node_id = "ws-demo-client".to_string();
    let mut router_url = "ws://127.0.0.1:7100".to_string();
    let mut address = SessionAddress::new(
        "domain-a",
        Some("runtime-ws".to_string()),
        Some("session-ws".to_string()),
    );
    let mut target: Option<SessionAddress> = None;

    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--help" | "-h" => {
                print_help();
                std::process::exit(0);
            }
            "--node-id" => {
                node_id = take_value(&mut args, "--node-id")?;
            }
            "--router-url" => {
                router_url = take_value(&mut args, "--router-url")?;
            }
            "--address" => {
                address = parse_address(&take_value(&mut args, "--address")?)?;
            }
            "--target" => {
                target = Some(parse_address(&take_value(&mut args, "--target")?)?);
            }
            other => bail!("unknown argument '{other}', use --help"),
        }
    }

    address.validate().map_err(|e| anyhow::anyhow!("{}", e))?;

    Ok(Args {
        node_id,
        router_url,
        address,
        target,
    })
}

fn take_value(args: &mut impl Iterator<Item = String>, flag: &str) -> Result<String> {
    args.next()
        .with_context(|| format!("{flag} requires a value"))
}

fn parse_address(value: &str) -> Result<SessionAddress> {
    let mut parts = value.split('/');
    let domain = parts.next().context("address requires domain")?;
    let runtime = parts.next().map(str::to_string);
    let session = parts.next().map(str::to_string);
    if parts.next().is_some() {
        bail!("address must be domain[/runtime[/session]]");
    }
    Ok(SessionAddress::new(domain, runtime, session))
}

fn format_address(address: &SessionAddress) -> String {
    match (&address.runtime, &address.session) {
        (Some(runtime), Some(session)) => format!("{}/{}/{}", address.domain, runtime, session),
        (Some(runtime), None) => format!("{}/{}/*", address.domain, runtime),
        (None, Some(session)) => format!("{}/*/{}", address.domain, session),
        (None, None) => format!("{}/*/*", address.domain),
    }
}

fn chrono_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn print_help() {
    println!("Usage: ws-client-demo [OPTIONS]");
    println!();
    println!("Options:");
    println!("  --node-id <id>        Client node ID (default: ws-demo-client)");
    println!("  --router-url <url>    WebSocket router URL (default: ws://127.0.0.1:7100)");
    println!("  --address <addr>      Session address as domain/runtime/session (default: domain-a/runtime-ws/session-ws)");
    println!("  --target <addr>       Target address for message (default: self)");
    println!("  -h, --help            Show this help");
}
