//! glassvein-osg-surface CLI
//!
//! Connects to a GlassVein `/glassvein/observe` WebSocket and prints
//! detected OSG session updates.

use anyhow::{Context, Result};
use futures_util::StreamExt;
use glassvein_osg_surface::{format_concise, try_parse_session_update, GlassVeinObservation};
use serde_json::Value;
use tokio_tungstenite::connect_async;
use tracing::{info, warn};

const DEFAULT_OBSERVE_URL: &str = "ws://127.0.0.1:4090/glassvein/observe";

// ───────────────────────────── CLI ───────────────────────────────

struct CliArgs {
    observe_url: String,
    json_output: bool,
}

fn parse_args() -> Result<CliArgs> {
    let args: Vec<String> = std::env::args().collect();
    let mut observe_url: Option<String> = None;
    let mut json_output = false;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--observe" => {
                i += 1;
                if i >= args.len() {
                    anyhow::bail!("--observe requires a <WS_URL> argument");
                }
                observe_url = Some(args[i].clone());
            }
            "--json" => {
                json_output = true;
            }
            "--help" | "-h" => {
                print_help();
                std::process::exit(0);
            }
            other => {
                anyhow::bail!("unknown argument: {other}");
            }
        }
        i += 1;
    }

    Ok(CliArgs {
        observe_url: observe_url.unwrap_or_else(|| DEFAULT_OBSERVE_URL.to_string()),
        json_output,
    })
}

fn print_help() {
    eprintln!(
        r#"glassvein-osg-surface — observe GlassVein OSG session updates via WebSocket

USAGE:
    glassvein-osg-surface [OPTIONS]

OPTIONS:
    --observe <WS_URL>   WebSocket URL to connect to
                         [default: ws://127.0.0.1:4090/glassvein/observe]
    --json               Output structured JSON for each session update
    -h, --help           Show this help message

EXAMPLES:
    glassvein-osg-surface
    glassvein-osg-surface --observe ws://myhost:4090/glassvein/observe
    glassvein-osg-surface --json --observe ws://myhost:4090/glassvein/observe"#
    );
}

// ───────────────────────────── Main ──────────────────────────────

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let cli = parse_args()?;

    info!(url = %cli.observe_url, "connecting to observe endpoint");

    let (ws_stream, _response) = connect_async(&cli.observe_url)
        .await
        .with_context(|| format!("failed to connect to {}", cli.observe_url))?;

    info!("connected — waiting for observations");

    let (_write, mut read) = ws_stream.split();

    while let Some(msg_result) = read.next().await {
        let msg = match msg_result {
            Ok(m) => m,
            Err(e) => {
                warn!(%e, "WebSocket read error");
                break;
            }
        };

        let text = match msg {
            tokio_tungstenite::tungstenite::Message::Text(t) => t.to_string(),
            tokio_tungstenite::tungstenite::Message::Close(_) => {
                info!("server closed connection");
                break;
            }
            _ => continue,
        };

        // Try to parse the top-level message as JSON.
        let outer: Value = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(_) => continue,
        };

        // Ignore hello messages.
        let msg_type = outer.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if msg_type == "GlassVeinObserveHello" {
            info!("received hello — ignoring");
            continue;
        }

        // Try to deserialize as GlassVeinObservation.
        let obs: GlassVeinObservation = match serde_json::from_str(&text) {
            Ok(o) => o,
            Err(_) => continue,
        };

        // Attempt to extract an OSG session update.
        let update = match try_parse_session_update(&obs) {
            Some(u) => u,
            None => continue,
        };

        if cli.json_output {
            let json_line = serde_json::to_string(&update)
                .unwrap_or_else(|_| "{\"error\":\"serialization failed\"}".to_string());
            println!("{json_line}");
        } else {
            println!("{}", format_concise(&update));
        }
    }

    Ok(())
}
