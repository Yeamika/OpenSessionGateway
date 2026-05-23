//! surface-viewer — real WebSocket connection to router.
//!
//! Connects to a GlassVein router via WebSocket, sends Hello with the
//! generic OSGP endpoint role plus `surface_viewer` capability, and
//! receives upload fan-out events.
//!
//! ## Role
//!
//! This is an **endpoint** (`role: "endpoint"`) that declares the
//! `surface_viewer` capability. It is NOT a router-internal
//! `ObserverSurface` role.
//!
//! ## Filtering
//!
//! Events are filtered by `type`/`subtype` fields on the envelope.
//!
//! ## Visibility
//!
//! - Only sees events from THIS router's forwarding activity
//! - Does NOT see parent/sibling router events (local-only by design)
//!
//! ## Usage
//!
//! ```bash
//! cargo run -p surface-viewer
//! cargo run -p surface-viewer -- --router-url ws://127.0.0.1:7200 --subtype-filter session_update
//! ```

use std::env;

use anyhow::{bail, Context, Result};
use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use osgp::{LinkMessage, SessionAddress};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::{info, warn};

#[derive(Debug, Clone)]
struct CliConfig {
    node_id: String,
    router_url: String,
    address: SessionAddress,
    subtype_filter: Option<String>,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .with_target(false)
        .init();

    let config = parse_args()?;
    let pid = std::process::id();

    println!("==============================================================");
    println!("  package     : surface-viewer");
    println!("  node_id     : {}", config.node_id);
    println!("  role        : endpoint");
    println!("  capabilities: [\"surface_viewer\"]");
    println!("  address     : {}", format_address(&config.address));
    println!("  router_url  : {}", config.router_url);
    println!("  pid         : {pid}");
    println!(
        "  subtype_filter : {}",
        config.subtype_filter.as_deref().unwrap_or("<none>")
    );
    println!("==============================================================");
    println!();

    // Connect to router
    info!(url = %config.router_url, "connecting to router");
    let (ws_stream, _) = connect_async(&config.router_url)
        .await
        .with_context(|| format!("failed to connect to {}", config.router_url))?;

    let (mut writer, mut reader) = ws_stream.split();

    // Send Hello as a generic endpoint. `surface_viewer` is an opaque weak
    // capability used by the router only for local upload fan-out.
    let hello = serde_json::json!({
        "nodeId": config.node_id,
        "role": "endpoint",
        "addresses": [config.address],
        "capabilities": ["surface_viewer"],
    });
    let hello_text = serde_json::to_string(&hello)?;
    writer.send(Message::Text(hello_text.into())).await?;
    info!(node_id = %config.node_id, "sent Hello as endpoint surface_viewer");

    // Drain Hello reply from router (HelloMessage, not LinkMessage)
    if let Some(msg_result) = reader.next().await {
        let msg = msg_result.context("read Hello reply")?;
        if let Message::Text(text) = msg {
            if let Ok(hello_reply) = serde_json::from_str::<Value>(&text) {
                if hello_reply.get("nodeId").is_some() {
                    let router_id = hello_reply["nodeId"].as_str().unwrap_or("unknown");
                    info!(router_id, "received Hello reply from router");
                }
            }
        }
    }

    println!("[surface-viewer] connected to {}", config.router_url);
    println!("[surface-viewer] subscribed to local upload fan-out via surface_viewer");
    println!("[surface-viewer] waiting for upload envelopes...");
    println!();

    // Read loop: receive upload fan-out envelopes from router
    let mut count: u64 = 0;
    while let Some(msg_result) = reader.next().await {
        let msg = match msg_result {
            Ok(m) => m,
            Err(e) => {
                warn!(error = %e, "WebSocket read error");
                break;
            }
        };

        let text = match msg {
            Message::Text(t) => t.to_string(),
            Message::Close(_) => {
                info!("router closed connection");
                break;
            }
            _ => continue,
        };

        // Parse as LinkMessage
        let link_msg: LinkMessage = match serde_json::from_str(&text) {
            Ok(m) => m,
            Err(e) => {
                warn!(error = %e, "failed to parse message");
                continue;
            }
        };

        match link_msg {
            LinkMessage::TypedEnvelope(envelope) => {
                count += 1;
                let subtype = envelope.subtype.clone();
                let source = format!("{:?}", envelope.source);
                let target = format!("{:?}", envelope.target);

                // Apply subtype filter
                if let Some(ref filter) = config.subtype_filter {
                    if subtype != *filter {
                        continue;
                    }
                }

                println!(
                    "[#{count}] type={:?} subtype={subtype} source={source} -> target={target}",
                    envelope.link_type
                );
                if let Some(last_hop) = envelope.route_hops.last() {
                    println!("       last_hop={last_hop:?}");
                }
                println!(
                    "       payload={}",
                    serde_json::to_string_pretty(&envelope.payload).unwrap_or_default()
                );
                println!();
            }
            LinkMessage::Envelope(envelope) => {
                count += 1;
                let subtype = &envelope.subtype;
                let source = format_address(&envelope.source);
                let target = format_address(&envelope.target);

                // Apply subtype filter
                if let Some(ref filter) = config.subtype_filter {
                    if subtype != filter {
                        continue;
                    }
                }

                println!(
                    "[#{count}] type={} subtype={} source={} -> target={}",
                    envelope.link_type, subtype, source, target
                );
                if let Some(surface) = &envelope.origin_surface {
                    println!("       origin_surface={surface}");
                }
                println!(
                    "       payload={}",
                    serde_json::to_string_pretty(&envelope.payload).unwrap_or_default()
                );
                println!();
            }
            LinkMessage::Ping => {
                // Respond with Pong
                let pong = serde_json::to_string(&LinkMessage::Pong)?;
                let _ = writer.send(Message::Text(pong.into())).await;
            }
            _ => {
                // Ignore other message types
            }
        }
    }

    info!(total_observations = count, "viewer session ended");
    Ok(())
}

fn parse_args() -> Result<CliConfig> {
    let mut node_id = "surface-viewer".to_string();
    let mut router_url = "ws://127.0.0.1:7200".to_string();
    let mut address = SessionAddress::new(
        "domain-a",
        Some("surface-runtime-viewer".into()),
        Some("surface-viewer".into()),
    );
    let mut subtype_filter = Some("session_update".to_string());

    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--help" | "-h" => {
                print_help();
                std::process::exit(0);
            }
            "--node-id" => node_id = take_value(&mut args, "--node-id")?,
            "--router-url" => router_url = take_value(&mut args, "--router-url")?,
            "--address" => address = parse_address(&take_value(&mut args, "--address")?)?,
            "--subtype-filter" => {
                subtype_filter = some_filter(take_value(&mut args, &arg)?)
            }
            other => bail!("unknown argument '{other}', use --help"),
        }
    }
    address
        .validate()
        .map_err(|error| anyhow::anyhow!(error.to_string()))?;
    Ok(CliConfig {
        node_id,
        router_url,
        address,
        subtype_filter,
    })
}

fn take_value(args: &mut impl Iterator<Item = String>, flag: &str) -> Result<String> {
    args.next()
        .with_context(|| format!("{flag} requires a value"))
}

fn some_filter(value: String) -> Option<String> {
    if value.trim().is_empty() || value == "none" || value == "-" {
        None
    } else {
        Some(value)
    }
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

fn print_help() {
    println!(
        "Usage: surface-viewer [OPTIONS]\n\
         \n\
         Options:\n\
         \x20   --router-url <ws-url>   Router WebSocket URL [default: ws://127.0.0.1:7200]\n\
         \x20   --node-id <id>          Node ID [default: surface-viewer]\n\
         \x20   --address <d/r/s>       Surface address\n\
         \x20   --subtype-filter <s>    Filter by OSGP type/subtype [default: session_update]\n\
         \x20   -h, --help              Show this help"
    );
}
