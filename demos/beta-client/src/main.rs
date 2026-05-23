//! beta-client — live GlassVein demo runtime client.
//!
//! Startup flow: Hello + Announce + SessionUpdate upload, then a bounded live
//! window that prints and responds to read/control traffic.

mod runtime_demo;

use std::env;

use anyhow::Result;
use osgp::SessionAddress;
use osgp_client::WebSocketTransportHandle;
use serde_json::json;

use runtime_demo::{
    announce_and_upload, build_update, format_address, live_loop, send_hello_handshake, DemoProfile,
};

const DEFAULT_LISTEN_SECONDS: u64 = 3;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    let args = parse_args()?;

    println!("==============================================================");
    println!("  beta-client — live demo runtime client");
    println!("  node_id    = {}", args.node_id);
    println!("  role       = endpoint");
    println!("  address    = {}", format_address(&args.address));
    println!("  router_url = {}", args.router_url);
    println!("  listen_s   = {}", args.listen_seconds);
    println!("  pid        = {}", std::process::id());
    println!("==============================================================");
    println!();

    println!("[1/6] Connecting to router at {}...", args.router_url);
    let transport = WebSocketTransportHandle::connect(&args.router_url).await?;
    println!("  OK: WebSocket connected");

    println!("[2/6] Sending Hello handshake...");
    send_hello_handshake(&transport, &args.node_id, &args.address).await?;
    println!("  OK: Hello handshake complete");

    println!("[3/6] Announce + upload session_update...");
    let profile = DemoProfile {
        label: "beta-client",
        node_id: "beta-client",
        session: "session-beta",
        state: osgp::SessionState::Idle,
        title: "Debug: router transport layer",
        summary: "Waiting for upstream WebSocket adapter to be implemented",
        metadata: json!({"model":"gpt-4o","task":"debugging","breakpoint":"crates/router/src/transport.rs:42","variables":{"peer_id":"beta-client","connected":false},"waiting_for":"ws-transport-adapter"}),
    };
    let update = build_update(&profile);
    let message_id = announce_and_upload(&transport, &args.node_id, &args.address, update).await?;
    println!("  OK: SessionUpdate sent (message_id: {})", message_id);

    live_loop(&transport, &profile, &args.address, args.listen_seconds).await?;

    println!("[6/6] Done.");
    Ok(())
}

struct Args {
    node_id: String,
    router_url: String,
    address: SessionAddress,
    listen_seconds: u64,
}

fn parse_args() -> Result<Args> {
    let mut node_id = "beta-client".to_string();
    let mut router_url = "ws://127.0.0.1:7202".to_string();
    let mut address = SessionAddress::new(
        "west",
        Some("runtime-beta".to_string()),
        Some("session-beta".to_string()),
    );
    let mut listen_seconds = DEFAULT_LISTEN_SECONDS;

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
            "--listen-seconds" => {
                listen_seconds = take_value(&mut args, "--listen-seconds")?.parse()?
            }
            "--stay-alive" => listen_seconds = 3600,
            "--once" => {
                println!(
                    "Config: node_id={}, router_url={}, address={}, listen_seconds={}",
                    node_id,
                    router_url,
                    format_address(&address),
                    listen_seconds
                );
                std::process::exit(0);
            }
            other => anyhow::bail!("unknown argument '{other}', use --help"),
        }
    }

    address.validate().map_err(|e| anyhow::anyhow!("{}", e))?;
    Ok(Args {
        node_id,
        router_url,
        address,
        listen_seconds,
    })
}

fn take_value(args: &mut impl Iterator<Item = String>, flag: &str) -> anyhow::Result<String> {
    use anyhow::Context;
    args.next()
        .with_context(|| format!("{flag} requires a value"))
}

fn parse_address(value: &str) -> anyhow::Result<SessionAddress> {
    use anyhow::bail;
    let mut parts = value.split('/');
    let domain = parts
        .next()
        .ok_or_else(|| anyhow::anyhow!("address requires domain"))?;
    let runtime = parts.next().map(str::to_string);
    let session = parts.next().map(str::to_string);
    if parts.next().is_some() {
        bail!("address must be domain[/runtime[/session]]");
    }
    Ok(SessionAddress::new(domain, runtime, session))
}

fn print_help() {
    println!("Usage: beta-client [OPTIONS]");
    println!();
    println!("Options:");
    println!("  --node-id <id>         Client node ID (default: beta-client)");
    println!("  --router-url <url>     WebSocket router URL (default: ws://127.0.0.1:7202)");
    println!("  --address <addr>       Session address as domain/runtime/session");
    println!("  --listen-seconds <n>   Live receive window in seconds (default: {DEFAULT_LISTEN_SECONDS})");
    println!("  --stay-alive           Keep the live window open for one hour");
    println!("  --once                 Print config and exit");
    println!("  -h, --help             Show this help");
}
