//! console-endpoint — htop-like GlassVein TUI management endpoint.
//!
//! Merges the former viewer session aggregation and control sender into one
//! human-operated endpoint. The wire path stays canonical OSGP:
//! address-level `source`/`target` and `upload`/`control`/`request`/`response`.
//!
//! Supports the router admin plane: send admin.request envelopes to
//! read/write routes and rules via the TUI or command mode.

mod admin;
mod client;
mod config;
mod control;
mod request;
mod state;
mod tui;

#[cfg(test)]
mod tests;

use anyhow::Result;
use futures_util::StreamExt;

use crate::{
    config::{parse_args, Mode},
    state::ConsoleState,
};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .with_target(false)
        .init();
    let config = parse_args()?;
    match config.mode {
        Mode::Tui => tui::run_tui(config).await,
        Mode::Once => run_once(config).await,
        Mode::Command => run_command(config).await,
    }
}

async fn run_once(config: config::Config) -> Result<()> {
    client::print_banner(&config);
    let (mut writer, mut reader) = client::connect_console(&config).await?;
    let mut state = ConsoleState::default();
    let deadline = tokio::time::sleep(config.smoke_duration);
    tokio::pin!(deadline);
    loop {
        tokio::select! {
            _ = &mut deadline => break,
            msg = reader.next() => {
                let Some(msg) = msg else { break; };
                if let Ok(msg) = msg {
                    tui::apply_message(&mut state, client::read_link_message(msg), &mut writer).await?;
                }
            }
        }
    }
    println!("{}", tui::render_to_string(&config, &state));
    Ok(())
}

async fn run_command(config: config::Config) -> Result<()> {
    client::print_banner(&config);
    let (mut writer, mut reader) = client::connect_console(&config).await?;
    let mut state = ConsoleState::default();
    tui::send_configured_command(&config, &mut writer).await?;
    let deadline = tokio::time::sleep(config.smoke_duration);
    tokio::pin!(deadline);
    loop {
        tokio::select! {
            _ = &mut deadline => break,
            msg = reader.next() => {
                let Some(msg) = msg else { break; };
                if let Ok(msg) = msg {
                    tui::apply_message(&mut state, client::read_link_message(msg), &mut writer).await?;
                }
            }
        }
    }
    println!("{}", tui::render_to_string(&config, &state));
    Ok(())
}
