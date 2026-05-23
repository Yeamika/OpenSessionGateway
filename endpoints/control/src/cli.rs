//! CLI configuration and argument parsing.

use std::env;

use anyhow::{bail, Context, Result};
use osgp::SessionAddress;

/// CLI configuration for the control endpoint.
#[derive(Debug, Clone)]
pub struct CliConfig {
    pub node_id: String,
    pub router_url: String,
    pub address: SessionAddress,
    pub target: SessionAddress,
    pub command: String,
    pub message: String,
}

/// Parse command-line arguments into a `CliConfig`.
pub fn parse_args() -> Result<CliConfig> {
    let mut node_id = "control-endpoint".to_string();
    let mut router_url = "ws://127.0.0.1:7201".to_string();
    let mut address = SessionAddress::new(
        "domain-a",
        Some("surface-runtime-control".into()),
        Some("surface-control".into()),
    );
    let mut target = SessionAddress::new(
        "domain-a",
        Some("runtime-alpha".into()),
        Some("session-alpha".into()),
    );
    let mut command = "addprompt".to_string();
    let mut message = "Hello from control endpoint".to_string();

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
            "--target" => target = parse_address(&take_value(&mut args, "--target")?)?,
            "--command" => command = take_value(&mut args, "--command")?,
            "--message" => message = take_value(&mut args, "--message")?,
            other => bail!("unknown argument '{other}', use --help"),
        }
    }
    address
        .validate()
        .map_err(|error| anyhow::anyhow!(error.to_string()))?;
    target
        .validate()
        .map_err(|error| anyhow::anyhow!(error.to_string()))?;
    Ok(CliConfig {
        node_id,
        router_url,
        address,
        target,
        command,
        message,
    })
}

pub fn take_value(args: &mut impl Iterator<Item = String>, flag: &str) -> Result<String> {
    args.next()
        .with_context(|| format!("{flag} requires a value"))
}

pub fn parse_address(value: &str) -> Result<SessionAddress> {
    let mut parts = value.split('/');
    let domain = parts.next().context("address requires domain")?;
    let runtime = parts.next().map(str::to_string);
    let session = parts.next().map(str::to_string);
    if parts.next().is_some() {
        bail!("address must be domain[/runtime[/session]]");
    }
    Ok(SessionAddress::new(domain, runtime, session))
}

pub fn format_address(address: &SessionAddress) -> String {
    match (&address.runtime, &address.session) {
        (Some(runtime), Some(session)) => format!("{}/{}/{}", address.domain, runtime, session),
        (Some(runtime), None) => format!("{}/{}/*", address.domain, runtime),
        (None, Some(session)) => format!("{}/*/{}", address.domain, session),
        (None, None) => format!("{}/*/*", address.domain),
    }
}

fn print_help() {
    println!(
        "Usage: control-endpoint [OPTIONS]\n\
         \n\
         Options:\n\
         \x20   --router-url <ws-url>   Router WebSocket URL [default: ws://127.0.0.1:7201]\n\
         \x20   --node-id <id>          Node ID [default: control-endpoint]\n\
         \x20   --address <d/r/s>       Endpoint address (source for reply routing)\n\
         \x20   --target <d/r/s>        Target session address\n\
         \x20   --command <cmd>         Command [default: addprompt]\n\
         \x20   --message <text>        Message/prompt text (meaning varies by command)\n\
         \x20   -h, --help              Show this help\n\
         \n\
         Control commands (canonical subtypes):\n\
         \x20   addprompt             → subtype add_prompt    Send prompt to session (--message = prompt text)\n\
         \x20   abort                 → subtype abort_session Abort session (--message = reason)\n\
         \x20   compact               → subtype compact_session Compact session\n\
         \x20   create_session        → subtype create_session  Create session on target runtime (--message = content)\n\
         \x20   rename_session        → subtype rename_session  Rename session (--message = new title)\n\
         \x20   resume_session        → subtype resume_session  Resume session (--message = resume text)\n\
         \x20   requestion_respond    → subtype requestion_respond Respond to requestion (--message = response)\n\
         \n\
         P-request commands (read operations):\n\
         \x20   runtime_requestion_snapshot     Runtime requestion snapshot\n\
         \x20   runtime_session_messages        List session messages\n\
         \x20   runtime_session_view_snapshot   Session view snapshot\n\
         \x20   runtime_workspace_view_snapshot Workspace tree/info snapshot\n\
         \n\
         Legacy aliases (accepted, map to canonical):\n\
         \x20   runtimeRequestionSnapshot → runtime_requestion_snapshot\n\
         \x20   requestionSnapshot        → runtime_requestion_snapshot\n\
         \x20   listSessionMessages       → runtime_session_messages\n\
         \x20   sessionViewSnapshot       → runtime_session_view_snapshot"
    );
}
