use anyhow::{bail, Context, Result};
use osgp::SessionAddress;

#[derive(Clone, Debug)]
pub struct Config {
    pub http_addr: String,
    pub router_url: String,
    pub config_path: Option<std::path::PathBuf>,
    pub node_id: String,
    pub address: SessionAddress,
    pub target: SessionAddress,
}

pub fn parse_args() -> Result<Config> {
    let mut cfg = Config {
        http_addr: "127.0.0.1:4092".into(),
        router_url: "ws://127.0.0.1:7200".into(),
        config_path: Some(crate::im_config::default_config_path()),
        node_id: "im-endpoint".into(),
        address: parse_address("domain-a/im-endpoint/session")?,
        target: parse_address("domain-a/im-backend/session")?,
    };
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--http" => cfg.http_addr = take(&mut args, &arg)?,
            "--router-url" => cfg.router_url = take(&mut args, &arg)?,
            "--node-id" => cfg.node_id = take(&mut args, &arg)?,
            "--address" => cfg.address = parse_address(&take(&mut args, &arg)?)?,
            "--target" => cfg.target = parse_address(&take(&mut args, &arg)?)?,
            "--config" => cfg.config_path = Some(std::path::PathBuf::from(take(&mut args, &arg)?)),
            "--no-config" => cfg.config_path = None,
            "-h" | "--help" => {
                print_help();
                std::process::exit(0);
            }
            other => bail!("unknown argument {other}"),
        }
    }
    cfg.address
        .validate()
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    cfg.target
        .validate()
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    Ok(cfg)
}

pub fn format_address(a: &SessionAddress) -> String {
    match (&a.runtime, &a.session) {
        (Some(r), Some(s)) => format!("{}/{}/{}", a.domain, r, s),
        (Some(r), None) => format!("{}/{}/*", a.domain, r),
        (None, Some(s)) => format!("{}/*/{}", a.domain, s),
        (None, None) => format!("{}/*/*", a.domain),
    }
}

fn take(args: &mut impl Iterator<Item = String>, flag: &str) -> Result<String> {
    args.next()
        .with_context(|| format!("{flag} requires a value"))
}

fn parse_address(value: &str) -> Result<SessionAddress> {
    let mut parts = value.split('/');
    let domain = parts.next().context("address requires domain")?;
    let runtime = parts.next().map(str::to_string);
    let session = parts.next().map(str::to_string);
    if parts.next().is_some() {
        bail!("address must be domain[/runtime[/session]]");
    }
    Ok(SessionAddress::new(domain, runtime, session))
}

fn print_help() {
    println!("Usage: im-endpoint [--http 127.0.0.1:4092] [--router-url ws://127.0.0.1:7200] [--config path|--no-config] [--address domain/runtime/session] [--target domain/runtime/session]");
}
