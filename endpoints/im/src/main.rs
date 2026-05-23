mod api;
mod config;
mod feishu;
mod gv;
mod im_config;
mod provider;
mod state;
#[cfg(test)]
mod tests;

use anyhow::Result;
use config::{format_address, parse_args};
use gv::GvClient;
use state::AppState;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .with_target(false)
        .init();
    let config = parse_args()?;
    println!("==============================================================");
    println!("  package    : im-endpoint");
    println!("  role       : endpoint");
    println!("  http       : {}", config.http_addr);
    println!("  router_url : {}", config.router_url);
    println!("  address    : {}", format_address(&config.address));
    println!("  target     : {}", format_address(&config.target));
    println!("  web        : http://{}/", config.http_addr);
    println!(
        "  config     : {}",
        config
            .config_path
            .as_ref()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| "none".into())
    );
    println!("==============================================================");
    let gv = GvClient::spawn(config.clone());
    let state = AppState::new(gv);
    state.set_config_path(config.config_path.clone()).await;
    state.reload_config().await?;
    api::serve(config.http_addr, state).await
}
