use anyhow::{bail, Context, Result};
use std::{env, net::SocketAddr, path::PathBuf};

#[derive(Debug, Clone)]
pub struct CliConfig {
    pub listen: Option<SocketAddr>,
    pub config_path: Option<PathBuf>,
}

pub fn parse_args() -> Result<CliConfig> {
    let mut listen: Option<SocketAddr> = None;
    let mut config_path: Option<PathBuf> = None;
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
                ));
            }
            other => bail!("unknown argument '{other}', use --help"),
        }
    }
    Ok(CliConfig {
        listen,
        config_path,
    })
}

fn print_help() {
    println!(
        "session-control-endpoint [--config endpoints/session/config.local.json] [--listen 127.0.0.1:7310]"
    );
}
