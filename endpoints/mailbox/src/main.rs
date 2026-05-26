mod cli;
mod config;
mod mailbox;
mod mcp;
mod state;
mod tools;
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

    let cli = cli::parse_args()?;
    let state = SharedState::new();
    let config = config::ConfigStore::new(cli.config_path, cli.listen);
    let runtime = config.load_initial(&state).await?;
    let listen = runtime.listen.parse()?;
    let tools = tools::MailboxToolServices::new();

    println!("mailbox-endpoint listening on http://{}", listen);
    web::serve(listen, state, tools, config).await
}
