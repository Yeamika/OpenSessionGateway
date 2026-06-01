use std::env;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{bail, Context, Result};
use router::{RouterConfig, RouterNode, StateStore};
use tracing::info;

#[cfg(test)]
#[path = "main/tests.rs"]
mod tests;

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

        // ── State store: load ──
        let state_store = StateStore::new(cli.state_file.clone());
        if let Some(path) = state_store.path() {
            let saved = state_store.load();
            if !saved.manual_routes.is_empty() || !saved.rules.is_empty() || !saved.persistent_grants.is_empty() {
                info!("loaded state from {}: {} manual routes, {} rules, {} persistent grants",
                    path.display(), saved.manual_routes.len(), saved.rules.len(), saved.persistent_grants.len());
                // Restore manual routes
                {
                    let mut rt = node.route_table.write().await;
                    for r in &saved.manual_routes {
                        rt.insert_manual(
                            router::format_address_parse(&r.address),
                            &r.neighbor,
                            r.distance,
                        );
                    }
                }
                // Restore rules via admin handler
                for sr in &saved.rules {
                    let def = router::admin::AdminRuleDef {
                        id: sr.id.clone(),
                        priority: sr.priority,
                        enabled: sr.enabled,
                        source_address: sr.source_address.as_deref().map(router::format_address_parse),
                        target_address: sr.target_address.as_deref().map(router::format_address_parse),
                        link_type: sr.link_type.clone(),
                        subtype: sr.subtype.clone(),
                        kind: sr.kind.clone(),
                        from_neighbor: sr.from_neighbor.clone(),
                        ttl_min: sr.ttl_min,
                        ttl_max: sr.ttl_max,
                        action: sr.action.clone(),
                    };
                    let resp = node.admin_handler.handle(router::admin::AdminRequest::RuleAdd { rule_def: def }).await;
                    if !resp.ok {
                        tracing::warn!("failed to restore rule '{}': {}", sr.id, resp.error.unwrap_or_default());
                    }
                }
                // Restore persistent grants
                {
                    let mut perms = node.permission_queue.write().await;
                    for grant in &saved.persistent_grants {
                        let id = perms.enqueue(grant.peer_id.clone(), grant.op.clone());
                        perms.approve(&id, grant.kind.clone());
                    }
                }
            }
        }

        // ── Banner ──
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
        if let Some(ref path) = cli.state_file {
            println!("  state_file    : {}", path.display());
        }
        if cli.operator_shell {
            println!("  operator_shell: enabled");
        }
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

        // ── Operator shell (if enabled) ──
        if cli.operator_shell {
            let node_for_shell = Arc::clone(&node);
            let audit_buffer = Arc::new(tokio::sync::RwLock::new(Vec::<String>::new()));
            let audit_for_shell = Arc::clone(&audit_buffer);

            tokio::spawn(async move {
                let executor = router::operator_shell::ShellExecutor {
                    admin: node_for_shell.admin_handler.clone(),
                    permissions: node_for_shell.permission_queue.clone(),
                    audit_buffer: audit_for_shell,
                    peer_info_fn: Arc::new(|| {
                        // In a real implementation, this would query the connection manager
                        vec![]
                    }),
                };

                println!("Operator shell ready. Type 'help' for commands.");
                loop {
                    use std::io::Write;
                    print!("gv> ");
                    std::io::stdout().flush().ok();

                    // Read stdin in a blocking task to avoid blocking tokio workers
                    let line = tokio::task::spawn_blocking(|| {
                        let stdin = std::io::stdin();
                        let mut input = String::new();
                        if stdin.read_line(&mut input).is_err() {
                            return None;
                        }
                        Some(input)
                    })
                    .await;

                    let input = match line {
                        Ok(Some(input)) => input,
                        _ => break,
                    };

                    let cmd = router::operator_shell::parse_command(&input);
                    if cmd == router::operator_shell::ShellCommand::Quit {
                        println!("Bye.");
                        break;
                    }
                    let output = executor.execute(cmd).await;
                    if output.is_error {
                        eprintln!("Error: {}", output);
                    } else {
                        println!("{}", output);
                    }
                }
            });
        }

        println!("Press Ctrl+C to stop.");

        // Wait for shutdown signal
        tokio::signal::ctrl_c().await.context("wait for ctrl-c")?;
        println!("Shutting down...");

        // ── State store: save on shutdown ──
        if cli.state_file.is_some() {
            let rt = node.route_table.read().await;
            let perms = node.permission_queue.read().await;
            let rule_table = node.admin_handler.rule_table().read().await;
            let manual = rt.list_manual();
            let grants: Vec<_> = perms
                .list_grants()
                .into_iter()
                .filter(|g| matches!(g.kind, gv_core::ApprovalKind::Persist))
                .cloned()
                .collect();
            let rules: Vec<router::state_store::SerializedRule> = rule_table
                .list_rules()
                .into_iter()
                .map(|r| router::state_store::SerializedRule {
                    id: r.id.clone(),
                    priority: r.priority,
                    enabled: r.enabled,
                    source_address: r.matcher.source_address.as_ref().map(|a| router::format_address(a)),
                    target_address: r.matcher.target_address.as_ref().map(|a| router::format_address(a)),
                    link_type: r.matcher.link_type.clone(),
                    subtype: r.matcher.subtype.clone(),
                    kind: r.matcher.kind.clone(),
                    from_neighbor: r.matcher.from_neighbor.clone(),
                    ttl_min: r.matcher.ttl_min,
                    ttl_max: r.matcher.ttl_max,
                    action: format_rule_action(&r.action),
                })
                .collect();
            let state = router::state_store::RouterState {
                schema_version: 1,
                node_id: node.node_id().to_string(),
                updated_at: chrono_now(),
                route_revision: rt.revision(),
                rule_revision: rule_table.revision(),
                permission_revision: perms.revision(),
                manual_routes: manual
                    .iter()
                    .map(|e| router::state_store::SerializedRouteEntry {
                        address: router::format_address(&e.address),
                        neighbor: e.neighbor.clone(),
                        distance: e.distance,
                    })
                    .collect(),
                rules,
                persistent_grants: grants,
                audit_log: Vec::new(),
            };
            if let Err(e) = state_store.save(&state) {
                eprintln!("Warning: failed to save state: {}", e);
            } else {
                println!("State saved.");
            }
        }

        Ok::<(), anyhow::Error>(())
    })
}

fn chrono_now() -> String {
    // Simple timestamp without pulling in chrono dependency
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| format!("{}", d.as_secs()))
        .unwrap_or_else(|_| "unknown".to_string())
}

/// Format a RuleAction back to its string-encoded form for persistence.
fn format_rule_action(action: &gv_core::RuleAction) -> String {
    match action {
        gv_core::RuleAction::Drop { reason } => format!("drop:{}", reason),
        gv_core::RuleAction::ForceNeighbor { neighbor_id } => format!("force:{}", neighbor_id),
        gv_core::RuleAction::DenyNeighbor { neighbor_id } => format!("deny:{}", neighbor_id),
        gv_core::RuleAction::Continue => "continue".to_string(),
    }
}

#[derive(Debug, Clone)]
struct CliConfig {
    node_id: String,
    bind_addr: String,
    upstream_urls: Vec<String>,
    tap_capacity: Option<usize>,
    state_file: Option<PathBuf>,
    operator_shell: bool,
}

fn parse_args() -> Result<CliConfig> {
    parse_args_from(env::args().skip(1))
}

/// Parse CLI arguments from an iterator (testable entry point).
fn parse_args_from(mut args: impl Iterator<Item = String>) -> Result<CliConfig> {
    let mut node_id = "root-router".to_string();
    let mut bind_addr = "127.0.0.1:7200".to_string();
    let mut upstream_urls = Vec::new();
    let mut tap_capacity = Some(128usize);
    let mut state_file = None;
    let mut operator_shell = false;

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
            "--state-file" => {
                state_file = Some(PathBuf::from(take_value(&mut args, "--state-file")?));
            }
            "--operator-shell" | "--admin-shell" => operator_shell = true,
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
        state_file,
        operator_shell,
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
    println!("  --state-file <path>       JSON state file for persistence");
    println!("  --operator-shell          Enable interactive operator shell");
    println!("  --admin-shell             Alias for --operator-shell");
}
