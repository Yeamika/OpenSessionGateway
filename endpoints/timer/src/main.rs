//! Timer endpoint — long-running service.
//!
//! Starts three concurrent subsystems:
//! 1. GV client (WebSocket to router, sends control/add_prompt on timer fire)
//! 2. HTTP/MCP server (JSON-RPC for CreateOneShotTimer, etc.)
//! 3. Timer scheduler loop (drains due timers, sends fire envelopes)

use anyhow::Result;
use tracing::info;

mod config;
mod cron;
mod gv_client;
mod mcp_api;
mod osgp_wire;
mod timer_store;
mod web;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_target(false)
        .init();

    info!("Timer endpoint starting...");

    // Parse CLI args
    let args = config::parse_args(std::env::args().skip(1));
    let cfg = config::load_config(args.config_path.as_deref())?;

    info!(host = %cfg.listen.host, port = cfg.listen.port, "HTTP listen config");
    info!(
        router_url = ?cfg.gv.router_url,
        domain = %cfg.gv.domain,
        runtime_id = %cfg.gv.runtime_id,
        peer_id = ?cfg.gv.peer_id,
        session_id = %cfg.gv.session_id,
        "GV connection config"
    );

    // Shared state
    let store = timer_store::TimerStore::new();
    let gv = gv_client::GvClient::start(cfg.clone());
    let mcp = mcp_api::McpApi::new(store.clone());

    let app_state = web::AppState {
        mcp,
        store: store.clone(),
        gv: gv.clone(),
        domain: cfg.gv.domain.clone(),
        runtime_id: cfg.gv.runtime_id.clone(),
        session_id: cfg.gv.session_id.clone(),
    };

    // HTTP listen address
    let addr = format!("{}:{}", cfg.listen.host, cfg.listen.port)
        .parse::<std::net::SocketAddr>()?;

    // Spawn timer scheduler loop
    let scheduler_gv = gv.clone();
    let scheduler_store = store.clone();
    let scheduler_config = cfg.clone();
    let scheduler_handle = tokio::spawn(async move {
        scheduler_loop(scheduler_gv, scheduler_store, scheduler_config).await;
    });

    // Run HTTP server (blocks until shutdown signal)
    let server_result = web::run_server(addr, app_state).await;

    // Cleanup
    scheduler_handle.abort();
    info!("Timer endpoint shutting down");

    server_result
}

/// Scheduler loop: every 500ms, drain due timers and send control/add_prompt.
async fn scheduler_loop(
    gv: gv_client::GvClient,
    store: timer_store::TimerStore,
    cfg: config::Config,
) {
    info!("timer scheduler loop started");
    loop {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        let due = store.drain_due_timers().await;
        for timer in due {
            info!(
                timer_id = %timer.timer_id,
                runtime_id = %timer.runtime_id,
                session_id = %timer.session_id,
                msg = %timer.msg,
                "timer fired — sending control/add_prompt"
            );

            // Build and send canonical control/add_prompt envelope
            let envelope = osgp_wire::create_timer_trigger_envelope(&cfg, &timer);
            if let Err(e) = gv.send_json(envelope) {
                tracing::error!(
                    timer_id = %timer.timer_id,
                    error = %e,
                    "failed to send timer trigger envelope"
                );
            }
        }
    }
}
