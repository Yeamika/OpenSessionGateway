//! control-endpoint — real WebSocket connection to router.
//!
//! Connects to a GlassVein router via WebSocket, sends Hello with the
//! generic OSGP endpoint role, and sends control commands to target sessions.
//!
//! ## Wire format (OSGP)
//!
//! Control envelopes use the canonical OSGP wire shape:
//! - `type` = `"control"` — top-level business link type
//! - `subtype` = `"add_prompt"` | `"abort_session"` | `"compact_session"` |
//!              `"create_session"` | `"rename_session"` | `"resume_session"` |
//!              `"requestion_respond"` — command verb
//!
//! Read requests use `type` = `"request"` / `type` = `"response"`.
//!
//! Canonical P-request commands (read operations):
//! - `runtime_requestion_snapshot`
//! - `runtime_session_messages`
//! - `runtime_session_view_snapshot`
//! - `runtime_workspace_view_snapshot`
//!
//! ## Cross-domain support
//!
//! Control commands can traverse domain boundaries. The endpoint
//! address is used as source/reply-to so responses route back.
//!
//! ## Usage
//!
//! ```bash
//! cargo run -p control-endpoint
//! cargo run -p control-endpoint -- --router-url ws://127.0.0.1:7201 --target domain-a/runtime-alpha/session-alpha --command addprompt --message "Hello!"
//! ```

mod cli;
mod command;

use anyhow::{bail, Context, Result};
use futures_util::{SinkExt, StreamExt};
use osgp::LinkMessage;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::{info, warn};

use cli::{format_address, parse_args};
use command::{build_and_send_command, read_response_loop, CommandOutcome};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .with_target(false)
        .init();

    let config = parse_args()?;
    let pid = std::process::id();

    println!("==============================================================");
    println!("  package    : control-endpoint");
    println!("  node_id    : {}", config.node_id);
    println!("  role       : endpoint");
    println!("  address    : {}", format_address(&config.address));
    println!("  router_url : {}", config.router_url);
    println!("  pid        : {pid}");
    println!("  target     : {}", format_address(&config.target));
    println!("  command    : {}", config.command);
    println!("==============================================================");
    println!();

    // Connect to router
    info!(url = %config.router_url, "connecting to router");
    let (ws_stream, _) = connect_async(&config.router_url)
        .await
        .with_context(|| format!("failed to connect to {}", config.router_url))?;

    let (mut writer, mut reader) = ws_stream.split();

    // Send Hello with the generic endpoint role.
    let hello = serde_json::json!({
        "nodeId": config.node_id,
        "role": "endpoint",
        "addresses": [config.address],
        "capabilities": [],
    });
    let hello_text = serde_json::to_string(&hello)?;
    writer.send(Message::Text(hello_text.into())).await?;
    info!(node_id = %config.node_id, address = %format_address(&config.address), "sent Hello as endpoint");

    // Drain router's Hello reply.
    match tokio::time::timeout(std::time::Duration::from_millis(500), reader.next()).await {
        Ok(Some(Ok(msg))) => {
            match msg {
                Message::Text(t) => {
                    info!(reply = %t, "drained router Hello reply");
                }
                Message::Close(_) => {
                    bail!("router closed connection during Hello");
                }
                _ => {}
            }
        }
        Ok(Some(Err(e))) => {
            warn!(error = %e, "error reading Hello reply");
        }
        Ok(None) => {
            warn!("reader ended before Hello reply");
        }
        Err(_) => {
            info!("no Hello reply from router (proceeding)");
        }
    }

    println!("[control-endpoint] connected to {}", config.router_url);
    println!("[control-endpoint] source address = {}", format_address(&config.address));
    println!();

    // Build and send command
    let outcome = build_and_send_command(&config, &mut writer).await?;

    match outcome {
        CommandOutcome::Envelope(envelope) => {
            let link_msg = LinkMessage::Envelope(envelope);
            let msg_text = serde_json::to_string(&link_msg)?;
            writer.send(Message::Text(msg_text.into())).await?;
            info!("control command sent");

            println!();
            println!("[control-endpoint] command sent, waiting for response...");

            read_response_loop(&mut reader, &mut writer).await
        }
        CommandOutcome::ReadSent => {
            read_response_loop(&mut reader, &mut writer).await
        }
    }
}
