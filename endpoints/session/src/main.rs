mod api;
mod cli;
mod config;
mod gv_client;
mod mailbox;
mod mcp;
mod session_bridge;
mod state;
mod web;

#[cfg(test)]
mod tests;

use anyhow::Result;
use state::SharedState;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .with_target(false)
        .init();

    let config = cli::parse_args()?;
    let state = SharedState::new();
    let gv = gv_client::GvClient::new(state.clone());
    let bridge = session_bridge::BridgeServices::new();
    let config_store = config::ConfigStore::new(config.config_path, config.listen);
    let runtime_config = config_store.load_initial(&state).await?;
    let listen = runtime_config.listen.parse()?;

    println!("session-endpoint listening on http://{}", listen);
    web::serve(listen, state, gv, bridge, config_store).await
}
