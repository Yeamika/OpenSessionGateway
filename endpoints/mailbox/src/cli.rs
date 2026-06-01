use anyhow::{bail, Context, Result};
use std::{env, net::SocketAddr, path::PathBuf};

#[derive(Debug, Clone)]
pub struct CliConfig {
    pub listen: Option<SocketAddr>,
    pub config_path: Option<PathBuf>,
    pub router_url: Option<String>,
    pub peer_id: String,
    /// Addresses to announce after LinkHandshake (e.g. "domain-a/mailbox-endpoint/mailbox").
    pub announce_addresses: Vec<String>,
}

pub fn parse_args() -> Result<CliConfig> {
    let mut listen = None;
    let mut config_path = None;
    let mut router_url = None;
    let mut peer_id = "mailbox-endpoint".to_string();
    let mut announce_addresses = Vec::new();
    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--help" | "-h" => {
                print_help();
                std::process::exit(0);
            }
            "--listen" => {
                listen = Some(
                    args.next()
                        .context("--listen requires host:port")?
                        .parse()
                        .context("invalid --listen address")?,
                );
            }
            "--config" => {
                config_path = Some(PathBuf::from(
                    args.next().context("--config requires path")?,
                ))
            }
            "--router-url" => {
                router_url = Some(
                    args.next()
                        .context("--router-url requires ws://host:port")?,
                );
            }
            "--peer-id" => {
                peer_id = args.next().context("--peer-id requires a value")?;
            }
            "--announce-address" => {
                announce_addresses.push(
                    args.next()
                        .context("--announce-address requires domain/runtime/session")?,
                );
            }
            other => bail!("unknown argument '{other}', use --help"),
        }
    }
    Ok(CliConfig {
        listen,
        config_path,
        router_url,
        peer_id,
        announce_addresses,
    })
}

fn print_help() {
    println!(
        "mailbox-endpoint [--config endpoints/mailbox/config.local.json] [--listen 127.0.0.1:7311] [--router-url ws://127.0.0.1:7200] [--peer-id mailbox-endpoint] [--announce-address domain/runtime/session]"
    );
}
