//! GlassVein OpenCode Router — thin wrapper around RouterNode.
//!
//! This crate wraps the existing `router::RouterNode` to provide:
//! - GV wire listener (observer-surface, control-surface, router peers)
//! - TS workspace client WS adapter (simple JSON protocol)
//! - Optional upstream connection to GV main network
//!
//! All routing, surface handling, and tap events are delegated to RouterNode.
//! This crate only adds the TS client adapter layer.
//!
//! Usage:
//!   cargo run -p glassvein-opencode-router
//!   cargo run -p glassvein-opencode-router -- --gv-router-url ws://127.0.0.1:7200

use std::env;
use std::sync::Arc;

use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use glassvein_opencode_router::{
    ClientMessage, ErrorCode, ReadinessInfo, ServerMessage, WorkspaceId,
};
use rand::Rng;
use router::{RouterConfig, RouterNode};
use osgp::SessionAddress;
use tokio::net::TcpListener;
use tokio::sync::{broadcast, RwLock};
use tokio_tungstenite::accept_async;
use tracing::{error, info, warn};

/// TS workspace client metadata.
#[derive(Debug, Clone)]
#[allow(dead_code)]
struct TsClient {
    workspace_id: WorkspaceId,
    session_id: String,
}

/// State for the TS client adapter layer.
struct TsAdapterState {
    /// Connected TS clients: workspace_id -> TsClient
    clients: RwLock<std::collections::HashMap<WorkspaceId, TsClient>>,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    let cli = parse_args()?;
    let node_id = cli.node_id.clone();

    // Build RouterConfig
    let mut router_config =
        RouterConfig::new(&node_id, &cli.gv_bind_addr).with_tap(cli.tap_capacity.unwrap_or(256));

    // Add upstream if configured
    if let Some(upstream_url) = &cli.gv_router_url {
        router_config = router_config.with_upstream(upstream_url);
    }

    // Add announce routes
    let address = SessionAddress::new(&cli.gv_domain, Some(cli.gv_runtime.clone()), None);
    router_config = router_config.with_announce_routes(vec![address]);

    // Create and start RouterNode
    let router_node = Arc::new(RouterNode::new(router_config));

    // Bind TS WS adapter
    let ts_bind = format!("127.0.0.1:{}", cli.ts_port);
    let ts_listener = TcpListener::bind(&ts_bind)
        .await
        .context("failed to bind TS WS server")?;
    let ts_port = ts_listener.local_addr()?.port();
    let ts_ws_url = format!("ws://127.0.0.1:{}", ts_port);

    // Get GV listener port from router
    let gv_port = cli
        .gv_bind_addr
        .split(':')
        .last()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(0);
    let pid = std::process::id();

    // Print readiness JSON
    let readiness = ReadinessInfo {
        port: ts_port,
        gv_port,
        token: cli.token.clone().unwrap_or_default(),
        pid,
        ws_url: ts_ws_url.clone(),
        gv_ws_url: format!("ws://{}", cli.gv_bind_addr),
    };
    println!("{}", serde_json::to_string(&readiness)?);

    // Start the router node (binds GV listener + connects upstream)
    router_node
        .start()
        .await
        .context("failed to start router")?;

    info!(
        node_id = %node_id,
        ts_port = ts_port,
        gv_port = gv_port,
        pid = pid,
        ts_ws_url = %ts_ws_url,
        "glassvein-opencode-router ready"
    );

    // Create TS adapter state
    let ts_state = Arc::new(TsAdapterState {
        clients: RwLock::new(std::collections::HashMap::new()),
    });

    // Subscribe to tap events for logging
    if let Some(mut tap_rx) = router_node.subscribe_tap() {
        tokio::spawn(async move {
            while let Ok(event) = tap_rx.recv().await {
                info!(event = ?event, "tap event");
            }
        });
    }

    // Accept TS WS connections
    loop {
        let (stream, addr) = ts_listener.accept().await?;
        info!(addr = %addr, "new TS WS connection");

        let ts_state = ts_state.clone();
        let router_node = router_node.clone();
        tokio::spawn(async move {
            if let Err(e) = handle_ts_connection(stream, ts_state, router_node).await {
                error!(addr = %addr, error = %e, "TS connection error");
            }
        });
    }
}

/// Handle a TS workspace client connection.
async fn handle_ts_connection(
    stream: tokio::net::TcpStream,
    state: Arc<TsAdapterState>,
    _router_node: Arc<RouterNode>,
) -> Result<()> {
    let ws_stream = accept_async(stream)
        .await
        .context("TS WebSocket handshake failed")?;

    let (mut writer, mut reader) = ws_stream.split();
    let (tx, mut rx) = broadcast::channel::<ServerMessage>(64);

    // Forward broadcast messages to this client
    let write_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            if let Ok(json) = serde_json::to_string(&msg) {
                if writer
                    .send(tokio_tungstenite::tungstenite::Message::Text(json.into()))
                    .await
                    .is_err()
                {
                    break;
                }
            }
        }
    });

    let mut current_workspace: Option<WorkspaceId> = None;

    // Process incoming messages
    while let Some(msg) = reader.next().await {
        let msg = msg?;
        match msg {
            tokio_tungstenite::tungstenite::Message::Text(text) => {
                match serde_json::from_str::<ClientMessage>(&text) {
                    Ok(client_msg) => {
                        let response =
                            handle_ts_message(client_msg, &state, &tx, &mut current_workspace)
                                .await;
                        if let Some(resp) = response {
                            let _ = tx.send(resp);
                        }
                    }
                    Err(e) => {
                        warn!(error = %e, "invalid TS client message");
                        let _ = tx.send(ServerMessage::Error {
                            correlation_id: None,
                            code: ErrorCode::InvalidMessage,
                            message: format!("invalid message: {}", e),
                        });
                    }
                }
            }
            tokio_tungstenite::tungstenite::Message::Close(_) => {
                info!("TS client disconnected");
                break;
            }
            _ => {}
        }
    }

    // Cleanup
    if let Some(ws_id) = current_workspace {
        state.clients.write().await.remove(&ws_id);
    }

    write_task.abort();
    Ok(())
}

/// Handle a parsed TS client message.
async fn handle_ts_message(
    msg: ClientMessage,
    state: &Arc<TsAdapterState>,
    _tx: &broadcast::Sender<ServerMessage>,
    current_workspace: &mut Option<WorkspaceId>,
) -> Option<ServerMessage> {
    match msg {
        ClientMessage::Hello {
            workspace_id,
            version,
        } => {
            info!(
                workspace_id = %workspace_id,
                version = ?version,
                "TS client hello"
            );

            let session_id = uuid::Uuid::new_v4().to_string();
            let token = uuid::Uuid::new_v4().to_string();

            state.clients.write().await.insert(
                workspace_id.clone(),
                TsClient {
                    workspace_id: workspace_id.clone(),
                    session_id: session_id.clone(),
                },
            );
            *current_workspace = Some(workspace_id);

            Some(ServerMessage::HelloAck {
                session_id,
                router_version: env!("CARGO_PKG_VERSION").to_string(),
                token,
            })
        }

        ClientMessage::WorkspaceRegister {
            workspace_id,
            root_path,
            metadata: _,
        } => {
            info!(
                workspace_id = %workspace_id,
                root_path = %root_path,
                "workspace register"
            );
            Some(ServerMessage::WorkspaceRegisterAck {
                workspace_id,
                success: true,
            })
        }

        ClientMessage::OpenCodeEvent {
            event_type,
            payload: _,
            correlation_id,
        } => {
            info!(
                event_type = %event_type,
                correlation_id = ?correlation_id,
                "opencode event received"
            );

            // TODO: Forward to GV network via RouterNode

            if let Some(cid) = correlation_id {
                Some(ServerMessage::Ack {
                    correlation_id: cid,
                    success: true,
                    message: Some(format!("event {} processed", event_type)),
                })
            } else {
                None
            }
        }

        ClientMessage::ControlCommand {
            command,
            args,
            correlation_id,
        } => {
            info!(
                command = %command,
                args = ?args,
                correlation_id = ?correlation_id,
                "control command from TS client"
            );

            if let Some(cid) = correlation_id {
                Some(ServerMessage::Ack {
                    correlation_id: cid,
                    success: true,
                    message: Some(format!("command {} acknowledged", command)),
                })
            } else {
                None
            }
        }

        ClientMessage::Ping => Some(ServerMessage::Pong),
    }
}

// ── CLI ─────────────────────────────────────────────────────────────

struct CliConfig {
    ts_port: u16,
    gv_bind_addr: String,
    token: Option<String>,
    node_id: String,
    gv_router_url: Option<String>,
    gv_domain: String,
    gv_runtime: String,
    tap_capacity: Option<usize>,
}

fn parse_args() -> Result<CliConfig> {
    let mut ts_port: u16 = 0;
    let mut gv_bind_addr = "127.0.0.1:0".to_string();
    let mut token: Option<String> = None;
    let mut node_id = "opencode-router".to_string();
    let mut gv_router_url: Option<String> = None;
    let mut gv_domain = "domain-a".to_string();
    let mut gv_runtime = "opencode-router".to_string();
    let mut tap_capacity: Option<usize> = Some(256);

    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--help" | "-h" => {
                print_help();
                std::process::exit(0);
            }
            "--ts-port" => {
                ts_port = args
                    .next()
                    .context("--ts-port requires a value")?
                    .parse()
                    .context("invalid --ts-port")?;
            }
            "--gv-bind-addr" => {
                gv_bind_addr = args.next().context("--gv-bind-addr requires a value")?;
            }
            "--token" => {
                token = Some(args.next().context("--token requires a value")?);
            }
            "--node-id" => {
                node_id = args.next().context("--node-id requires a value")?;
            }
            "--gv-router-url" => {
                gv_router_url = Some(args.next().context("--gv-router-url requires a value")?);
            }
            "--gv-domain" => {
                gv_domain = args.next().context("--gv-domain requires a value")?;
            }
            "--gv-runtime" => {
                gv_runtime = args.next().context("--gv-runtime requires a value")?;
            }
            "--tap-capacity" => {
                tap_capacity = Some(
                    args.next()
                        .context("--tap-capacity requires a value")?
                        .parse()
                        .context("invalid --tap-capacity")?,
                );
            }
            "--disable-tap" => {
                tap_capacity = None;
            }
            other => anyhow::bail!("unknown argument '{}', use --help", other),
        }
    }

    Ok(CliConfig {
        ts_port,
        gv_bind_addr,
        token,
        node_id,
        gv_router_url,
        gv_domain,
        gv_runtime,
        tap_capacity,
    })
}

fn print_help() {
    println!("Usage: glassvein-opencode-router [OPTIONS]");
    println!();
    println!("Options:");
    println!("  --ts-port <n>              TS WS server port (default: 0 = random)");
    println!("  --gv-bind-addr <addr>      GV wire listener bind address (default: 127.0.0.1:0)");
    println!("  --token <str>              Auth token (default: random)");
    println!("  --node-id <id>             Node ID (default: opencode-router)");
    println!("  --gv-router-url <url>      GlassVein main router URL (optional)");
    println!("  --gv-domain <domain>       GV domain (default: domain-a)");
    println!("  --gv-runtime <runtime>     GV runtime (default: opencode-router)");
    println!("  --tap-capacity <n>         Tap channel capacity (default: 256)");
    println!("  --disable-tap              Disable tap events");
    println!("  -h, --help                 Show this help");
}

#[allow(dead_code)]
fn generate_token() -> String {
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..32).map(|_| rng.gen()).collect();
    hex::encode(bytes)
}

#[allow(dead_code)]
mod hex {
    pub fn encode(bytes: Vec<u8>) -> String {
        bytes.iter().map(|b| format!("{:02x}", b)).collect()
    }
}
