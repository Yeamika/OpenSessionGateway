//! Command building and response loop for the control endpoint.

use anyhow::{bail, Result};
use futures_util::{SinkExt, StreamExt};
use osgp::{LinkMessage, ReadOperation, ReadRequest, SessionId};
use tokio_tungstenite::tungstenite::Message;
use tracing::{info, warn};

use crate::cli::{format_address, CliConfig};

/// Outcome of building a command: either an envelope to send, or a
/// read request that has already been sent (caller should go straight
/// to the response loop).
pub enum CommandOutcome {
    /// An envelope to send via `LinkMessage::Envelope`.
    Envelope(osgp::SessionEnvelope),
    /// A read request already sent; go straight to response loop.
    ReadSent,
}

/// Build the command specified by CLI config.
///
/// For control commands returns an envelope. For read commands (canonical
/// P-request types), sends the ReadRequest directly on the writer and
/// returns `CommandOutcome::ReadSent`.
///
/// Canonical control subtypes (7):
/// - `add_prompt` — send a prompt to a target session
/// - `abort_session` — abort a target session
/// - `compact_session` — compact a target session
/// - `create_session` — create a new session on a target runtime
/// - `rename_session` — rename a target session
/// - `resume_session` — resume a target session
/// - `requestion_respond` — respond to a pending requestion
///
/// Canonical P-request commands (4):
/// - `runtime_requestion_snapshot`
/// - `runtime_session_messages`
/// - `runtime_session_view_snapshot`
/// - `runtime_workspace_view_snapshot`
pub async fn build_and_send_command(
    config: &CliConfig,
    writer: &mut futures_util::stream::SplitSink<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        Message,
    >,
) -> Result<CommandOutcome> {
    match config.command.as_str() {
        "addprompt" => {
            let surface = surface::ControlSurface::new(
                &config.node_id,
                config.address.clone(),
            );
            let env = surface.build_addprompt(
                config.target.clone(),
                &config.message,
                Some("control-endpoint-cli"),
                None::<String>,
            );
            println!("sending addprompt:");
            println!("  source  = {}", format_address(&env.source));
            println!("  target  = {}", format_address(&env.target));
            println!("  type    = {}", env.link_type);
            println!("  subtype = {}", env.subtype);
            println!("  payload = {}", serde_json::to_string_pretty(&env.payload).unwrap_or_default());
            Ok(CommandOutcome::Envelope(env))
        }
        "abort" => {
            let surface = surface::ControlSurface::new(
                &config.node_id,
                config.address.clone(),
            );
            let env = surface.build_abort(config.target.clone(), Some(&config.message));
            println!("sending abort:");
            println!("  type    = {}", env.link_type);
            println!("  subtype = {}", env.subtype);
            println!("  payload = {}", serde_json::to_string_pretty(&env.payload).unwrap_or_default());
            Ok(CommandOutcome::Envelope(env))
        }
        "compact" => {
            let surface = surface::ControlSurface::new(
                &config.node_id,
                config.address.clone(),
            );
            let env = surface.build_compact(config.target.clone(), Some(true));
            println!("sending compact:");
            println!("  type    = {}", env.link_type);
            println!("  subtype = {}", env.subtype);
            println!("  payload = {}", serde_json::to_string_pretty(&env.payload).unwrap_or_default());
            Ok(CommandOutcome::Envelope(env))
        }
        "create_session" => {
            let surface = surface::ControlSurface::new(
                &config.node_id,
                config.address.clone(),
            );
            let content = if config.message.is_empty() { None } else { Some(&config.message) };
            let env = surface.build_create_session(config.target.clone(), content, None::<String>);
            println!("sending create_session:");
            println!("  type    = {}", env.link_type);
            println!("  subtype = {}", env.subtype);
            println!("  payload = {}", serde_json::to_string_pretty(&env.payload).unwrap_or_default());
            Ok(CommandOutcome::Envelope(env))
        }
        "rename_session" => {
            let surface = surface::ControlSurface::new(
                &config.node_id,
                config.address.clone(),
            );
            let env = surface.build_rename_session(config.target.clone(), &config.message);
            println!("sending rename_session:");
            println!("  type    = {}", env.link_type);
            println!("  subtype = {}", env.subtype);
            println!("  payload = {}", serde_json::to_string_pretty(&env.payload).unwrap_or_default());
            Ok(CommandOutcome::Envelope(env))
        }
        "resume_session" => {
            let surface = surface::ControlSurface::new(
                &config.node_id,
                config.address.clone(),
            );
            let message = if config.message.is_empty() { None } else { Some(&config.message) };
            let env = surface.build_resume_session(config.target.clone(), message);
            println!("sending resume_session:");
            println!("  type    = {}", env.link_type);
            println!("  subtype = {}", env.subtype);
            println!("  payload = {}", serde_json::to_string_pretty(&env.payload).unwrap_or_default());
            Ok(CommandOutcome::Envelope(env))
        }
        "requestion_respond" => {
            let surface = surface::ControlSurface::new(
                &config.node_id,
                config.address.clone(),
            );
            let env = surface.build_requestion_respond(config.target.clone(), &config.message);
            println!("sending requestion_respond:");
            println!("  type    = {}", env.link_type);
            println!("  subtype = {}", env.subtype);
            println!("  payload = {}", serde_json::to_string_pretty(&env.payload).unwrap_or_default());
            Ok(CommandOutcome::Envelope(env))
        }
        "runtime_requestion_snapshot" | "runtimeRequestionSnapshot" | "requestionSnapshot" => {
            send_read_request(config, writer, build_runtime_requestion_snapshot(config)).await
        }
        "runtime_session_messages" | "listSessionMessages" => {
            send_read_request(config, writer, build_runtime_session_messages(config)).await
        }
        "runtime_session_view_snapshot" | "sessionViewSnapshot" => {
            send_read_request(config, writer, build_runtime_session_view_snapshot(config)).await
        }
        "runtime_workspace_view_snapshot" => {
            send_read_request(config, writer, build_runtime_workspace_view_snapshot(config)).await
        }
        other => bail!(
            "unsupported command '{other}', expected addprompt|abort|compact|create_session|rename_session|resume_session|requestion_respond|runtime_requestion_snapshot|runtime_session_messages|runtime_session_view_snapshot|runtime_workspace_view_snapshot"
        ),
    }
}

/// Send a ReadRequest and return `CommandOutcome::ReadSent`.
async fn send_read_request(
    config: &CliConfig,
    writer: &mut futures_util::stream::SplitSink<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        Message,
    >,
    request: ReadRequest,
) -> Result<CommandOutcome> {
    println!("sending ReadRequest ({}):", config.command);
    println!("  request_id = {}", request.request_id);
    println!("  source     = {}", format_address(&config.address));
    println!("  target     = {}", format_address(&config.target));
    let msg_text = serde_json::to_string(&LinkMessage::ReadRequest(request))?;
    writer.send(Message::Text(msg_text.into())).await?;
    info!("{} request sent", config.command);

    println!();
    println!("[control-endpoint] request sent, waiting for response...");
    Ok(CommandOutcome::ReadSent)
}

// ── Read request builders ──────────────────────────────────────────

fn build_runtime_requestion_snapshot(config: &CliConfig) -> ReadRequest {
    let session_id = config.target.session.clone().unwrap_or_else(|| "default".into());
    let runtime_id = config.target.runtime.clone().unwrap_or_else(|| "default".into());
    ReadRequest::new(
        config.address.clone(),
        config.target.clone(),
        ReadOperation::RuntimeRequestionSnapshot {
            runtime_id,
            session_id: Some(SessionId::new(&session_id)),
            status: if config.message.is_empty() { None } else { Some(config.message.clone()) },
            blocking: false,
        },
    )
}

fn build_runtime_session_messages(config: &CliConfig) -> ReadRequest {
    let session_id = config.target.session.clone().unwrap_or_else(|| "default".into());
    let runtime_id = config.target.runtime.clone().unwrap_or_else(|| "default".into());
    ReadRequest::new(
        config.address.clone(),
        config.target.clone(),
        ReadOperation::RuntimeSessionMessages {
            runtime_id,
            session_id: SessionId::new(&session_id),
            anchor_time: None,
            limit: Some(10),
            regex: None,
        },
    )
}

fn build_runtime_session_view_snapshot(config: &CliConfig) -> ReadRequest {
    let session_id = config.target.session.clone().unwrap_or_else(|| "default".into());
    let runtime_id = config.target.runtime.clone().unwrap_or_else(|| "default".into());
    let requestion_status = if config.message.is_empty() { None } else { Some(config.message.clone()) };
    ReadRequest::new(
        config.address.clone(),
        config.target.clone(),
        ReadOperation::RuntimeSessionViewSnapshot {
            runtime_id,
            session_id: SessionId::new(&session_id),
            requestion_status,
        },
    )
}

fn build_runtime_workspace_view_snapshot(config: &CliConfig) -> ReadRequest {
    let runtime_id = config.target.runtime.clone().unwrap_or_else(|| "default".into());
    let workspace = if config.message.is_empty() { None } else { Some(config.message.clone()) };
    ReadRequest::new(
        config.address.clone(),
        config.target.clone(),
        ReadOperation::RuntimeWorkspaceViewSnapshot {
            runtime_id,
            workspace,
        },
    )
}

// ── Response loop ──────────────────────────────────────────────────

/// Read response loop: receives and prints LinkMessages from the router.
///
/// Handles ReadResponse (cross-domain replies), TypedEnvelope, Envelope,
/// and Ping/Pong.
pub async fn read_response_loop(
    reader: &mut futures_util::stream::SplitStream<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
    >,
    writer: &mut futures_util::stream::SplitSink<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        Message,
    >,
) -> Result<()> {
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

        let link_msg: LinkMessage = match serde_json::from_str(&text) {
            Ok(m) => m,
            Err(e) => {
                warn!(error = %e, text = %text, "failed to parse message");
                continue;
            }
        };

        match link_msg {
            LinkMessage::ReadResponse(response) => {
                count += 1;
                println!("[read-response #{count}]");
                println!("  request_id = {}", response.request_id);
                println!("  trace_id   = {}", response.trace_id);
                println!("  status     = {:?}", response.status);
                println!("  is_ok      = {}", response.is_ok());
                if !response.payload.is_null() {
                    println!(
                        "  payload    = {}",
                        serde_json::to_string_pretty(&response.payload).unwrap_or_default()
                    );
                }
                println!();

                if count >= 1 {
                    println!("[control-endpoint] response received, exiting");
                    break;
                }
            }
            LinkMessage::TypedEnvelope(envelope) => {
                count += 1;
                println!(
                    "[response #{count}] type={:?} subtype={} source={:?} -> target={:?}",
                    envelope.link_type, envelope.subtype, envelope.source, envelope.target,
                );
                println!(
                    "  payload = {}",
                    serde_json::to_string_pretty(&envelope.payload).unwrap_or_default()
                );
                println!();

                if count >= 1 {
                    println!("[control-endpoint] response received, exiting");
                    break;
                }
            }
            LinkMessage::Envelope(envelope) => {
                count += 1;
                println!(
                    "[response #{count}] type={} subtype={} source={} -> target={}",
                    envelope.link_type,
                    envelope.subtype,
                    format_address(&envelope.source),
                    format_address(&envelope.target),
                );
                println!(
                    "  payload = {}",
                    serde_json::to_string_pretty(&envelope.payload).unwrap_or_default()
                );
                println!();

                if count >= 1 {
                    println!("[control-endpoint] response received, exiting");
                    break;
                }
            }
            LinkMessage::Ping => {
                let pong = serde_json::to_string(&LinkMessage::Pong)?;
                let _ = writer.send(Message::Text(pong.into())).await;
            }
            _ => {}
        }
    }

    info!(responses = count, "control-endpoint session ended");
    Ok(())
}
