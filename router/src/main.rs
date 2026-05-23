use std::env;
use std::sync::Arc;

use anyhow::{bail, Context, Result};
use router::{RouterConfig, RouterNode};

fn main() -> Result<()> {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let cli = parse_args()?;

    let mut router_config =
        RouterConfig::new(&cli.node_id, &cli.bind_addr).with_tap(cli.tap_capacity.unwrap_or(128));

    for url in &cli.upstream_urls {
        router_config = router_config.with_upstream(url);
    }

    // Create tokio runtime and run the router
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .context("create tokio runtime")?;

    runtime.block_on(async move {
        let node = Arc::new(RouterNode::new(router_config));
        let pid = std::process::id();
        let ws_url = format!("ws://{}", cli.bind_addr);

        println!("==============================================================");
        println!("  GlassVein Router");
        println!("==============================================================");
        println!("  node_id       : {}", node.node_id());
        println!("  role          : router");
        println!("  pid           : {}", pid);
        println!("  bind_addr     : {}", cli.bind_addr);
        println!("  ws_url        : {}", ws_url);
        println!(
            "  upstream_urls : {}",
            if cli.upstream_urls.is_empty() {
                "<none>".to_string()
            } else {
                cli.upstream_urls.join(", ")
            }
        );
        println!(
            "  tap_capacity  : {}",
            cli.tap_capacity
                .map(|v| v.to_string())
                .unwrap_or_else(|| "disabled".to_string())
        );
        println!("==============================================================");
        println!();

        // Start the router (binds listener + connects upstream)
        node.start().await?;

        println!(
            "Router {} listening on {} (PID {})",
            node.node_id(),
            ws_url,
            pid
        );
        println!("Press Ctrl+C to stop.");

        // Wait for shutdown signal
        tokio::signal::ctrl_c().await.context("wait for ctrl-c")?;
        println!("Shutting down...");

        Ok::<(), anyhow::Error>(())
    })
}

#[derive(Debug, Clone)]
struct CliConfig {
    node_id: String,
    bind_addr: String,
    upstream_urls: Vec<String>,
    tap_capacity: Option<usize>,
}

fn parse_args() -> Result<CliConfig> {
    let mut node_id = "root-router".to_string();
    let mut bind_addr = "127.0.0.1:7200".to_string();
    let mut upstream_urls = Vec::new();
    let mut tap_capacity = Some(128usize);

    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--help" | "-h" => {
                print_help();
                std::process::exit(0);
            }
            "--node-id" => node_id = take_value(&mut args, "--node-id")?,
            "--bind-addr" => bind_addr = take_value(&mut args, "--bind-addr")?,
            "--upstream-url" | "--upstream" => upstream_urls.push(take_value(&mut args, &arg)?),
            "--upstream-urls" => {
                upstream_urls = split_csv(&take_value(&mut args, "--upstream-urls")?)
            }
            "--clear-upstreams" => upstream_urls.clear(),
            "--tap-capacity" => {
                tap_capacity = Some(
                    take_value(&mut args, "--tap-capacity")?
                        .parse()
                        .context("invalid --tap-capacity")?,
                )
            }
            "--disable-tap" => tap_capacity = None,
            other => bail!("unknown argument '{other}', use --help"),
        }
    }

    if node_id.trim().is_empty() {
        bail!("--node-id must not be empty");
    }
    if bind_addr.trim().is_empty() {
        bail!("--bind-addr must not be empty");
    }

    Ok(CliConfig {
        node_id,
        bind_addr,
        upstream_urls,
        tap_capacity,
    })
}

fn take_value(args: &mut impl Iterator<Item = String>, flag: &str) -> Result<String> {
    args.next()
        .with_context(|| format!("{flag} requires a value"))
}

fn split_csv(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_string)
        .collect()
}

fn print_help() {
    println!("Usage: cargo run -p router -- [options]\n");
    println!("Options:");
    println!("  --node-id <id>            Router node id [default: root-router]");
    println!("  --bind-addr <host:port>   Router bind address [default: 127.0.0.1:7200]");
    println!("  --upstream-url <ws-url>   Append one upstream URL");
    println!("  --upstream-urls <csv>     Replace upstream URL list");
    println!("  --clear-upstreams         Remove upstream URLs");
    println!("  --tap-capacity <n>        Enable tap with capacity n [default: 128]");
    println!("  --disable-tap             Disable tap");
}
