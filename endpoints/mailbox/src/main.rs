mod cli;
mod config;
mod mailbox;
mod mcp;
mod router;
mod state;
mod tools;
mod web;

#[cfg(test)]
mod tests;

use anyhow::Result;
use osgp::{LinkMessage, SessionAddress};
use state::SharedState;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .with_target(false)
        .init();

    let cli = cli::parse_args()?;
    let state = SharedState::new();
    let config = config::ConfigStore::new(cli.config_path, cli.listen);
    let runtime = config.load_initial(&state).await?;
    let listen = runtime.listen.parse()?;

    // Parse announce/receive addresses from CLI
    let receive_addresses: Vec<SessionAddress> = cli
        .announce_addresses
        .iter()
        .filter_map(|s| parse_session_address(s))
        .collect();
    let mailbox_domain = receive_addresses
        .first()
        .map(|addr| addr.domain.clone())
        .unwrap_or_else(|| "domain-a".into());

    // Connect to router if --router-url is provided.
    // The handle MUST be kept alive for the duration of the process;
    // dropping it would drop the outgoing channel sender, causing the
    // background connection task to exit immediately.
    let (tools, _router_handle) = if let Some(ref router_url) = cli.router_url {
        let router_config = router::RouterConnConfig {
            router_url: router_url.clone(),
            peer_id: cli.peer_id.clone(),
            announce_addresses: receive_addresses.clone(),
        };
        let (incoming_tx, mut incoming_rx) = tokio::sync::mpsc::unbounded_channel();
        let handle = router::connect_router(router_config, incoming_tx).await?;
        state.set_router_status("connecting").await;
        println!(
            "mailbox-endpoint connecting to router {} as '{}'",
            router_url, cli.peer_id
        );

        // Create tools with outbound channel and receive addresses
        let tools = tools::MailboxToolServices::new_with_router_domain(
            handle.tx.clone(),
            receive_addresses.clone(),
            mailbox_domain.clone(),
        );

        // Inbound envelope interception: handle delivery envelopes
        let tools_clone = tools.clone();
        let outbound_tx = handle.tx.clone();
        let state_clone = state.clone();
        let match_addrs = receive_addresses.clone();
        tokio::spawn(async move {
            while let Some(msg) = incoming_rx.recv().await {
                // Check if this is a delivery envelope for our receive addresses
                if let LinkMessage::Envelope(ref env) = msg {
                    if is_delivery_for_us(env, &match_addrs) {
                        if let Some(args) = extract_delivery_args(env) {
                            match tools_clone.deliver(args, Some(&outbound_tx)).await {
                                Ok(item_id) => {
                                    state_clone
                                        .log(
                                            "inbound_delivery",
                                            serde_json::json!({
                                                "envelope_id": env.id.to_string(),
                                                "ok": true,
                                                "item_id": item_id,
                                            }),
                                        )
                                        .await;
                                }
                                Err(e) => {
                                    tracing::warn!(error = %e, "inbound delivery failed");
                                    state_clone
                                        .log(
                                            "inbound_delivery_error",
                                            serde_json::json!({
                                                "envelope_id": env.id.to_string(),
                                                "error": e.to_string(),
                                            }),
                                        )
                                        .await;
                                }
                            }
                            continue;
                        }
                    }
                }
                // Not a delivery envelope — log as before
                state_clone
                    .log(
                        "router_message",
                        serde_json::to_value(&msg).unwrap_or_default(),
                    )
                    .await;
            }
        });

        // Monitor router status
        let state_clone = state.clone();
        let mut status_rx = handle.status_rx.clone();
        tokio::spawn(async move {
            while status_rx.changed().await.is_ok() {
                let s = status_rx.borrow().clone();
                let label = match s {
                    router::RouterStatus::Disconnected => "disconnected",
                    router::RouterStatus::Connecting => "connecting",
                    router::RouterStatus::Connected => "connected",
                    router::RouterStatus::Error(ref e) => {
                        tracing::warn!(error = %e, "router connection error");
                        "error"
                    }
                };
                state_clone.set_router_status(label).await;
            }
        });

        (tools, Some(handle))
    } else {
        (tools::MailboxToolServices::new(), None)
    };

    println!("mailbox-endpoint listening on http://{}", listen);
    web::serve(listen, state, tools, config).await
}

/// Parse a "domain/runtime/session" address string into SessionAddress.
fn parse_session_address(s: &str) -> Option<SessionAddress> {
    let parts: Vec<&str> = s.split('/').collect();
    match parts.len() {
        1 => Some(SessionAddress::new(
            parts[0],
            None::<String>,
            None::<String>,
        )),
        2 => Some(SessionAddress::new(
            parts[0],
            Some(parts[1].to_string()),
            None::<String>,
        )),
        3 => Some(SessionAddress::new(
            parts[0],
            Some(parts[1].to_string()),
            Some(parts[2].to_string()),
        )),
        _ => {
            tracing::warn!(address = %s, "invalid address format, expected domain/runtime/session");
            None
        }
    }
}

/// Check if an envelope is a delivery for any of our receive addresses.
/// Matches: linkType=control, subtype=add_prompt, target matches a receive address,
/// payload.mailbox.kind=deliver.
fn is_delivery_for_us(env: &osgp::SessionEnvelope, receive_addrs: &[SessionAddress]) -> bool {
    if env.link_type != "control" || env.subtype != "add_prompt" {
        return false;
    }
    let is_deliver = env
        .payload
        .get("mailbox")
        .and_then(|m| m.get("kind"))
        .and_then(|v| v.as_str())
        == Some("deliver");
    if !is_deliver {
        return false;
    }
    // Check if target matches any of our receive addresses
    receive_addrs.iter().any(|addr| {
        addr.domain == env.target.domain
            && (addr.runtime.is_none() || addr.runtime == env.target.runtime)
            && (addr.session.is_none() || addr.session == env.target.session)
    })
}

/// Extract delivery args from an inbound envelope.
fn extract_delivery_args(env: &osgp::SessionEnvelope) -> Option<tools::DeliveryArgs> {
    let mailbox = env.payload.get("mailbox")?;
    Some(tools::DeliveryArgs {
        recipient_runtime_id: mailbox
            .get("recipientRuntimeID")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string(),
        recipient_session_id: mailbox
            .get("recipientSessionID")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string(),
        sender_runtime_id: mailbox
            .get("senderRuntimeID")
            .and_then(|v| v.as_str())
            .or_else(|| env.source.runtime.as_deref())
            .unwrap_or("unknown")
            .to_string(),
        sender_session_id: mailbox
            .get("senderSessionID")
            .and_then(|v| v.as_str())
            .or_else(|| env.source.session.as_deref())
            .unwrap_or("unknown")
            .to_string(),
        sender_session_title: mailbox
            .get("senderSessionTitle")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown Sender")
            .to_string(),
        title: mailbox
            .get("title")
            .and_then(|v| v.as_str())
            .or_else(|| {
                env.payload
                    .get("prompt")
                    .and_then(|p| p.get("msg"))
                    .and_then(|v| v.as_str())
            })
            .unwrap_or("Untitled")
            .to_string(),
        content: mailbox
            .get("content")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        info_type: mailbox
            .get("infoType")
            .and_then(|v| v.as_str())
            .unwrap_or("Notice")
            .to_string(),
    })
}
