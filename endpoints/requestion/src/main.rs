//! requestion-endpoint — requestion cache/snapshot endpoint.
//!
//! Connects to a GlassVein router as a generic endpoint with `surface_viewer`
//! capability. Collects requestion/permission/question events and provides
//! snapshot queries via ReadRequest/ReadResponse.
//!
//! ## Handshake
//!
//! By default sends `LinkHandshake` (OSGP vNext) with `peer_id` only.
//! The `--legacy-hello` flag falls back to `HelloMessage` with `role`,
//! `capabilities`, and `addresses` for backward compatibility.
//!
//! ## Role
//!
//! This is a **requestion cache/snapshot endpoint**, NOT an ObserverSurface.
//! - Receives local upload fan-out (via surface_viewer capability).
//! - Materializes its own cache view — the router does NOT store state.
//! - Route announcement requires `announce.route` permission grant from router.
//!
//! ## Collected events (OSGP requestion semantics)
//!
//! - `session_update`: updates session state cache
//! - `requestion_asked`: upserts pending requestion
//! - `requestion_resolved` / `requestion_cancelled`: removes requestion
//! - `requestion_updated`: merges/updates requestion
//! - `permission_asked`: treated as requestion item (OSGP unified model)
//! - `question_asked`: treated as requestion item (OSGP unified model)
//!
//! ## ReadRequest support
//!
//! - `SessionUpdateSnapshot`: returns cached session state
//! - `RequestionSnapshot`: returns pending requestions for a session
//! - `RuntimeRequestionSnapshot`: returns runtime-level question/permission/requestion snapshot
//! - `SessionViewSnapshot`: returns combined session + requestions
//!
//! ## Usage
//!
//! ```bash
//! cargo run -p requestion-endpoint
//! cargo run -p requestion-endpoint -- --router-url ws://127.0.0.1:7200
//! cargo run -p requestion-endpoint -- --legacy-hello  # fallback to legacy handshake
//! ```

mod cache;
mod cli;
mod gv_client;
mod handler;
mod seed;
mod web;

use std::sync::Arc;

use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use osgp::LinkMessage;
use tokio::sync::{mpsc, RwLock};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::{debug, info, warn};

use cache::{RequestionCache, SessionStateCache};
use cli::{format_address, parse_args};
use handler::{handle_envelope, handle_read_request};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .with_target(false)
        .init();

    let config = parse_args()?;
    let runtime_config = Arc::new(RwLock::new(config.clone()));
    let pid = std::process::id();

    println!("==============================================================");
    println!("  package       : requestion-endpoint");
    println!("  node_id       : {}", config.node_id);
    println!("  role          : endpoint");
    println!("  capabilities  : surface_viewer");
    println!("  handshake     : {}", if config.legacy_hello { "legacy HelloMessage" } else { "LinkHandshake (vNext)" });
    println!("  seed_demo     : {}", config.seed_demo);
    println!(
        "  web_api       : {}",
        if config.no_web {
            "disabled"
        } else {
            &config.web_addr
        }
    );
    println!("  address       : {}", format_address(&config.address));
    println!("  router_url    : {}", config.router_url);
    println!("  pid           : {pid}");
    println!("==============================================================");
    println!();

    // Shared caches
    let session_cache = Arc::new(RwLock::new(SessionStateCache::new()));
    let requestion_cache = Arc::new(RwLock::new(RequestionCache::new()));
    let (outbound_tx, mut outbound_rx) = mpsc::channel::<gv_client::OutboundControl>(64);

    // Connect to router
    info!(url = %config.router_url, "connecting to router");
    let (ws_stream, _) = connect_async(&config.router_url)
        .await
        .with_context(|| format!("failed to connect to {}", config.router_url))?;

    let (mut writer, mut reader) = ws_stream.split();

    // Send Hello/LinkHandshake to router.
    //
    // Default: LinkHandshake (OSGP vNext) — no role/capabilities, just peer_id.
    // Fallback: legacy HelloMessage with role + capabilities + addresses.
    // The router accepts both formats; LinkHandshake is the forward-compatible path.
    if config.legacy_hello {
        #[allow(deprecated)]
        let hello = serde_json::json!({
            "nodeId": config.node_id,
            "role": "endpoint",
            "addresses": [config.address],
            "capabilities": ["surface_viewer"],
        });
        let hello_text = serde_json::to_string(&hello)?;
        writer.send(Message::Text(hello_text.into())).await?;
        info!(node_id = %config.node_id, "sent legacy HelloMessage as endpoint");
    } else {
        let handshake = osgp::LinkHandshake::new(&config.node_id);
        let handshake_text = serde_json::to_string(&handshake)?;
        writer.send(Message::Text(handshake_text.into())).await?;
        info!(node_id = %config.node_id, "sent LinkHandshake (vNext)");
    }

    // Drain Hello reply from router
    if let Some(msg_result) = reader.next().await {
        let msg = msg_result.context("read Hello reply")?;
        if let Message::Text(text) = msg {
            if let Ok(hello_reply) = serde_json::from_str::<serde_json::Value>(&text) {
                if hello_reply.get("nodeId").is_some() {
                    let router_id = hello_reply["nodeId"].as_str().unwrap_or("unknown");
                    info!(router_id, "received Hello reply from router");
                }
            }
        }
    }

    // Send Announce to register our address with the router.
    // Required for the endpoint to receive forwarded messages.
    // Router permission gate: needs `announce.route` grant for this peer.
    let announce = serde_json::to_string(&LinkMessage::Announce {
        address: config.address.clone(),
        distance: 0,
    })?;
    writer.send(Message::Text(announce.into())).await?;
    info!(address = %format_address(&config.address), "sent Announce (requires announce.route grant)");

    println!("[requestion-endpoint] connected to {}", config.router_url);
    println!("[requestion-endpoint] collecting requestion/permission/question events");

    // Seed demo data if requested (demo/testing only).
    if config.seed_demo {
        {
            let mut sc = session_cache.write().await;
            let mut rc = requestion_cache.write().await;
            seed::seed_demo_data(&mut sc, &mut rc);
        }
        println!("[requestion-endpoint] demo mode: seeded synthetic requestion data");
    }

    if !config.no_web {
        let web_config = runtime_config.clone();
        let web_sessions = session_cache.clone();
        let web_requestions = requestion_cache.clone();
        let web_outbound = outbound_tx.clone();
        tokio::spawn(async move {
            if let Err(error) =
                web::run_web_server(web_config, web_sessions, web_requestions, web_outbound).await
            {
                eprintln!("[requestion-endpoint] web/MCP API stopped: {error}");
            }
        });
    }

    println!("[requestion-endpoint] waiting for events...");
    println!();

    // Main read loop
    let mut event_count: u64 = 0;
    loop {
        tokio::select! {
            msg_result = reader.next() => {
                let Some(msg_result) = msg_result else { break; };
                let config_snapshot = runtime_config.read().await.clone();
                let should_continue = handle_router_message(
                    msg_result,
                    &session_cache,
                    &requestion_cache,
                    &mut writer,
                    &config_snapshot,
                    &mut event_count,
                ).await?;
                if !should_continue { break; }
            }
            Some(outbound) = outbound_rx.recv() => {
                let text = serde_json::to_string(&LinkMessage::TypedEnvelope(outbound.envelope))?;
                writer.send(Message::Text(text.into())).await?;
                info!(subtype = "requestion_respond", "sent outbound control");
            }
        }
    }

    info!(
        total_events = event_count,
        "requestion-endpoint session ended"
    );
    Ok(())
}

async fn handle_router_message(
    msg_result: std::result::Result<Message, tokio_tungstenite::tungstenite::Error>,
    session_cache: &Arc<RwLock<SessionStateCache>>,
    requestion_cache: &Arc<RwLock<RequestionCache>>,
    writer: &mut futures_util::stream::SplitSink<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        Message,
    >,
    config: &cli::CliConfig,
    event_count: &mut u64,
) -> Result<bool> {
    let msg = match msg_result {
        Ok(m) => m,
        Err(e) => {
            warn!(error = %e, "WebSocket read error");
            return Ok(false);
        }
    };

    let text = match msg {
        Message::Text(t) => t.to_string(),
        Message::Close(_) => {
            info!("router closed connection");
            return Ok(false);
        }
        _ => return Ok(true),
    };

    let link_msg: LinkMessage = match serde_json::from_str(&text) {
        Ok(m) => m,
        Err(e) => {
            // Silently skip legacy tap_event messages that may still
            // appear from older router versions.
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                if json.get("type").and_then(|v| v.as_str()) == Some("tap_event") {
                    debug!("ignoring tap_event");
                    return Ok(true);
                }
            }
            warn!(error = %e, "failed to parse message");
            return Ok(true);
        }
    };

    match link_msg {
        LinkMessage::Envelope(envelope) => {
            *event_count += 1;
            handle_envelope(&envelope, session_cache, requestion_cache).await;
        }
        LinkMessage::ReadRequest(request) => {
            handle_read_request(&request, session_cache, requestion_cache, writer, config).await;
        }
        LinkMessage::Ping => {
            let pong = serde_json::to_string(&LinkMessage::Pong)?;
            let _ = writer.send(Message::Text(pong.into())).await;
        }
        _ => {
            debug!(message_variant = ?std::mem::discriminant(&link_msg), "ignoring message");
        }
    }
    Ok(true)
}
