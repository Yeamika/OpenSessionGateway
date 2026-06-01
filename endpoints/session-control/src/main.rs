mod api;
mod cli;
mod config;
mod gv_client;
mod link_handshake;
mod mcp;
mod session_tools;
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
    let session_tools = session_tools::SessionToolServices::new();
    let config_store = config::ConfigStore::new(config.config_path, config.listen);
    let runtime_config = config_store.load_initial(&state).await?;
    let listen = runtime_config.listen.parse()?;

    println!("session-control-endpoint listening on http://{}", listen);
    web::serve(listen, state, gv, session_tools, config_store).await
}
