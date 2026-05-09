use std::{env, fs, path::PathBuf};

use anyhow::{bail, Context, Result};
use glassvein_protocol::RouteAddress;
use glassvein_router::{run_router, RouterConfig};
use serde::Deserialize;
use tracing_subscriber::EnvFilter;

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileConfig {
    #[serde(alias = "nodeID", alias = "node_id")]
    node_id: Option<String>,
    #[serde(alias = "bind", alias = "bind_addr")]
    bind_addr: Option<String>,
    #[serde(default, alias = "upstreams", alias = "upstream_urls")]
    upstream_urls: Vec<String>,
    #[serde(default, alias = "routes", alias = "announce_routes")]
    announce_routes: Vec<RouteAddress>,
}

#[derive(Debug, Default)]
struct CliArgs {
    config_path: Option<PathBuf>,
    node_id: Option<String>,
    bind_addr: Option<String>,
    upstream_urls: Vec<String>,
    announce_routes: Vec<RouteAddress>,
}

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();

    let args = parse_args(env::args().skip(1))?;
    let file_config = read_file_config(args.config_path.as_ref())?;

    let node_id = args
        .node_id
        .or(file_config.node_id)
        .unwrap_or_else(|| "glassvein-router".to_string());
    let bind_addr = args
        .bind_addr
        .or(file_config.bind_addr)
        .unwrap_or_else(|| "127.0.0.1:4090".to_string());

    let upstream_urls = if args.upstream_urls.is_empty() {
        file_config.upstream_urls
    } else {
        args.upstream_urls
    };

    let mut announce_routes = file_config.announce_routes;
    announce_routes.extend(args.announce_routes);

    run_router(RouterConfig {
        node_id,
        bind_addr,
        upstream_urls,
        announce_routes,
    })
    .await
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("glassvein_router=info,glassvein_router_cli=info,info"));
    tracing_subscriber::fmt().with_env_filter(filter).init();
}

fn read_file_config(path: Option<&PathBuf>) -> Result<FileConfig> {
    let Some(path) = path else {
        return Ok(FileConfig::default());
    };
    let text =
        fs::read_to_string(path).with_context(|| format!("read config file {}", path.display()))?;
    serde_json::from_str(&text).with_context(|| format!("parse config file {}", path.display()))
}

fn parse_args<I>(args: I) -> Result<CliArgs>
where
    I: IntoIterator<Item = String>,
{
    let mut parsed = CliArgs::default();
    let mut iter = args.into_iter().peekable();

    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "router" => {
                // Allow `glassvein-router router ...` while keeping the binary itself simple.
            }
            "-h" | "--help" => {
                print_help();
                std::process::exit(0);
            }
            "-V" | "--version" => {
                println!("glassvein-router {}", env!("CARGO_PKG_VERSION"));
                std::process::exit(0);
            }
            "-c" | "--config" => {
                parsed.config_path = Some(PathBuf::from(next_value(&mut iter, &arg)?));
            }
            "--node-id" | "--node" => {
                parsed.node_id = Some(next_value(&mut iter, &arg)?);
            }
            "--bind" | "--bind-addr" => {
                parsed.bind_addr = Some(next_value(&mut iter, &arg)?);
            }
            "--upstream" => {
                parsed.upstream_urls.push(next_value(&mut iter, &arg)?);
            }
            "--route" | "--announce-route" => {
                let route = next_value(&mut iter, &arg)?;
                parsed.announce_routes.push(parse_route_address(&route)?);
            }
            _ if arg.starts_with("--config=") => {
                parsed.config_path = Some(PathBuf::from(value_after_equals(&arg)));
            }
            _ if arg.starts_with("--node-id=") => {
                parsed.node_id = Some(value_after_equals(&arg));
            }
            _ if arg.starts_with("--bind=") => {
                parsed.bind_addr = Some(value_after_equals(&arg));
            }
            _ if arg.starts_with("--bind-addr=") => {
                parsed.bind_addr = Some(value_after_equals(&arg));
            }
            _ if arg.starts_with("--upstream=") => {
                parsed.upstream_urls.push(value_after_equals(&arg));
            }
            _ if arg.starts_with("--route=") => {
                let route = value_after_equals(&arg);
                parsed.announce_routes.push(parse_route_address(&route)?);
            }
            _ if arg.starts_with("--announce-route=") => {
                let route = value_after_equals(&arg);
                parsed.announce_routes.push(parse_route_address(&route)?);
            }
            _ => bail!("unknown argument: {arg}\n\n{}", help_text()),
        }
    }

    Ok(parsed)
}

fn next_value<I>(iter: &mut std::iter::Peekable<I>, flag: &str) -> Result<String>
where
    I: Iterator<Item = String>,
{
    iter.next()
        .filter(|value| !value.trim().is_empty())
        .with_context(|| format!("missing value for {flag}"))
}

fn value_after_equals(arg: &str) -> String {
    arg.split_once('=')
        .map(|(_, value)| value)
        .unwrap_or("")
        .to_string()
}

fn parse_route_address(raw: &str) -> Result<RouteAddress> {
    let parts = raw.split('/').collect::<Vec<_>>();
    if parts.is_empty() || parts[0].trim().is_empty() {
        bail!("route must start with a domain id: {raw}");
    }
    if parts.len() > 3 {
        bail!("route must be domain[/runtime[/session]]: {raw}");
    }

    Ok(RouteAddress {
        domain_id: parts[0].trim().to_string(),
        runtime_id: optional_route_part(parts.get(1).copied()),
        session_id: optional_route_part(parts.get(2).copied()),
    })
}

fn optional_route_part(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    if value.is_empty() || value == "*" {
        None
    } else {
        Some(value.to_string())
    }
}

fn print_help() {
    println!("{}", help_text());
}

fn help_text() -> &'static str {
    "glassvein-router\n\nUSAGE:\n  glassvein-router [router] [OPTIONS]\n\nOPTIONS:\n  -c, --config <FILE>          Read router config JSON\n      --node-id <ID>           Router node id (default: glassvein-router)\n      --bind <ADDR>            Listen address (default: 127.0.0.1:4090)\n      --upstream <WS_URL>      Upstream router WebSocket URL; repeatable\n      --route <ADDR>           Announced route as domain[/runtime[/session]]; repeatable\n  -h, --help                   Print help\n  -V, --version                Print version\n\nCONFIG JSON EXAMPLE:\n  {\n    \"nodeId\": \"router-a\",\n    \"bindAddr\": \"0.0.0.0:4090\",\n    \"upstreamUrls\": [\"ws://127.0.0.1:4089\"],\n    \"announceRoutes\": [\n      { \"domainId\": \"domain-a\", \"runtimeId\": \"runtime-a\", \"sessionId\": \"session-a\" }\n    ]\n  }\n"
}
