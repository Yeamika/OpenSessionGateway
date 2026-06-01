use std::{env, fs, time::Duration};

use anyhow::{bail, Context, Result};
use osgp::SessionAddress;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Mode {
    Tui,
    Once,
    Command,
}

#[derive(Debug, Clone)]
pub struct Config {
    pub mode: Mode,
    pub node_id: String,
    pub router_url: String,
    pub address: SessionAddress,
    pub target: SessionAddress,
    pub refresh_interval: Duration,
    pub smoke_duration: Duration,
    pub command: String,
    pub message: String,
    /// 显式启用 admin write 操作（route_add/route_remove/rule_remove）。
    /// 默认 false，需要 operator 通过 --enable-admin-write 显式授权。
    pub enable_admin_write: bool,
}

pub fn parse_args() -> Result<Config> {
    let mut cfg = Config {
        mode: Mode::Tui,
        node_id: "console-endpoint".into(),
        router_url: "ws://127.0.0.1:7200".into(),
        address: parse_address("domain-a/console-runtime/console")?,
        target: parse_address("domain-a/runtime-alpha/session-alpha")?,
        refresh_interval: Duration::from_millis(1000),
        smoke_duration: Duration::from_millis(1500),
        command: "runtime_session_view_snapshot".into(),
        message: String::new(),
        enable_admin_write: false, // 默认禁用 admin write
    };
    let mut args = env::args().skip(1).peekable();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--config" => apply_config(&mut cfg, &take(&mut args, "--config")?)?,
            "--once" | "--smoke" => cfg.mode = Mode::Once,
            "--command-mode" | "--send" => cfg.mode = Mode::Command,
            "--router-url" => cfg.router_url = take(&mut args, "--router-url")?,
            "--node-id" => cfg.node_id = take(&mut args, "--node-id")?,
            "--address" => cfg.address = parse_address(&take(&mut args, "--address")?)?,
            "--target" => cfg.target = parse_address(&take(&mut args, "--target")?)?,
            "--refresh-interval-ms" => {
                cfg.refresh_interval =
                    Duration::from_millis(take(&mut args, &arg)?.parse::<u64>()?.max(100));
            }
            "--smoke-duration-ms" => {
                cfg.smoke_duration =
                    Duration::from_millis(take(&mut args, &arg)?.parse::<u64>()?.max(100));
            }
            "--command" => cfg.command = normalize_command(&take(&mut args, "--command")?),
            "--message" => cfg.message = take(&mut args, "--message")?,
            "--enable-admin-write" => cfg.enable_admin_write = true,
            "-h" | "--help" => {
                print_help();
                std::process::exit(0);
            }
            other => bail!("unknown argument '{other}', use --help"),
        }
    }
    cfg.address
        .validate()
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    cfg.target
        .validate()
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    Ok(cfg)
}

fn apply_config(cfg: &mut Config, path: &str) -> Result<()> {
    let value: Value = serde_json::from_str(
        &fs::read_to_string(path).with_context(|| format!("read config {path}"))?,
    )?;
    if let Some(v) = value.get("mode").and_then(Value::as_str) {
        cfg.mode = match v {
            "tui" => Mode::Tui,
            "once" | "smoke" => Mode::Once,
            "command" => Mode::Command,
            other => bail!("unsupported config mode '{other}'"),
        };
    }
    if let Some(v) = value.get("nodeId").and_then(Value::as_str) {
        cfg.node_id = v.into();
    }
    if let Some(v) = value.get("routerUrl").and_then(Value::as_str) {
        cfg.router_url = v.into();
    }
    if let Some(v) = value.get("address").and_then(Value::as_str) {
        cfg.address = parse_address(v)?;
    }
    if let Some(v) = value.get("target").and_then(Value::as_str) {
        cfg.target = parse_address(v)?;
    }
    if let Some(v) = value.get("refreshIntervalMs").and_then(Value::as_u64) {
        cfg.refresh_interval = Duration::from_millis(v.max(100));
    }
    if let Some(v) = value.get("smokeDurationMs").and_then(Value::as_u64) {
        cfg.smoke_duration = Duration::from_millis(v.max(100));
    }
    if let Some(v) = value.get("command").and_then(Value::as_str) {
        cfg.command = normalize_command(v);
    }
    if let Some(v) = value.get("message").and_then(Value::as_str) {
        cfg.message = v.into();
    }
    if let Some(v) = value.get("enableAdminWrite").and_then(Value::as_bool) {
        cfg.enable_admin_write = v;
    }
    Ok(())
}

pub fn normalize_command(value: &str) -> String {
    match value {
        "addprompt" => "add_prompt",
        "abort" => "abort_session",
        "compact" => "compact_session",
        "resume" => "resume_session",
        other => other,
    }
    .to_string()
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
        (Some(r), Some(s)) => format!("{}/{}/{}", address.domain, r, s),
        (Some(r), None) => format!("{}/{}/*", address.domain, r),
        (None, Some(s)) => format!("{}/*/{}", address.domain, s),
        (None, None) => format!("{}/*/*", address.domain),
    }
}

fn take(args: &mut impl Iterator<Item = String>, flag: &str) -> Result<String> {
    args.next()
        .with_context(|| format!("{flag} requires a value"))
}

fn print_help() {
    println!("Usage: console-endpoint [--config file] [--once|--command-mode] [OPTIONS]\n\
Options: --router-url <ws> --node-id <id> --address <d/r/s> --target <d/r/s>\n\
         --command <cmd> --message <text> --refresh-interval-ms <ms>\n\
         --enable-admin-write   Enable admin write operations (route_add/route_remove/rule_remove)\n\
                                Default: disabled. Requires explicit operator authorization.\n\
Commands: abort_session resume_session compact_session add_prompt rename_session create_session\n\
Requests: runtime_session_view_snapshot runtime_session_messages runtime_workspace_view_snapshot runtime_requestion_snapshot\n\
Admin (read-only, always available):\n\
          admin_route_list admin_route_list_manual admin_rule_list admin_revision\n\
Admin (write, requires --enable-admin-write):\n\
          admin_route_add admin_route_remove admin_rule_remove\n\
          (use --command admin_route_list etc. in command mode)");
}
