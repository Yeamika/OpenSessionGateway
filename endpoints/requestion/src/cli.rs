//! CLI configuration and argument parsing.

use std::{env, fs, path::PathBuf};

use anyhow::{bail, Context, Result};
use osgp::SessionAddress;
use serde::Deserialize;

/// CLI configuration for the requestion endpoint.
#[derive(Debug, Clone)]
pub struct CliConfig {
    pub node_id: String,
    pub router_url: String,
    pub address: SessionAddress,
    pub web_addr: String,
    pub no_web: bool,
    pub config_path: Option<PathBuf>,
    /// When true, seed the cache with synthetic requestion data after connecting.
    /// For demo/testing only — the endpoint is passive by default.
    pub seed_demo: bool,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct FileConfig {
    node_id: Option<String>,
    router_url: Option<String>,
    address: Option<String>,
    web_addr: Option<String>,
    no_web: Option<bool>,
    seed_demo: Option<bool>,
}

/// Parse command-line arguments into a `CliConfig`.
pub fn parse_args() -> Result<CliConfig> {
    let mut config = default_config();
    let mut config_path: Option<PathBuf> = None;
    let mut overrides = FileConfig::default();

    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--help" | "-h" => {
                print_help();
                std::process::exit(0);
            }
            "--config" => config_path = Some(PathBuf::from(take_value(&mut args, "--config")?)),
            "--node-id" => overrides.node_id = Some(take_value(&mut args, "--node-id")?),
            "--router-url" => overrides.router_url = Some(take_value(&mut args, "--router-url")?),
            "--address" => overrides.address = Some(take_value(&mut args, "--address")?),
            "--web-addr" => overrides.web_addr = Some(take_value(&mut args, "--web-addr")?),
            "--no-web" => overrides.no_web = Some(true),
            "--seed-demo" => overrides.seed_demo = Some(true),
            other => bail!("unknown argument '{other}', use --help"),
        }
    }
    if let Some(path) = &config_path {
        apply_file_config(&mut config, &read_config_file(path)?)?;
    }
    apply_file_config(&mut config, &overrides)?;
    config.config_path = config_path;
    validate_config(&config)?;
    Ok(config)
}

pub fn default_config() -> CliConfig {
    CliConfig {
        node_id: "requestion-endpoint".to_string(),
        router_url: "ws://127.0.0.1:7200".to_string(),
        address: SessionAddress::new(
            "domain-a",
            Some("requestion-endpoint".into()),
            Some("requestion-endpoint".into()),
        ),
        web_addr: "127.0.0.1:7318".to_string(),
        no_web: false,
        config_path: None,
        seed_demo: false,
    }
}

pub fn reload_from_config_path(current: &CliConfig) -> Result<CliConfig> {
    let Some(path) = &current.config_path else {
        return Ok(current.clone());
    };
    let mut next = current.clone();
    apply_file_config(&mut next, &read_config_file(path)?)?;
    next.config_path = Some(path.clone());
    validate_config(&next)?;
    Ok(next)
}

fn read_config_file(path: &PathBuf) -> Result<FileConfig> {
    let text =
        fs::read_to_string(path).with_context(|| format!("read config {}", path.display()))?;
    serde_json::from_str(&text).with_context(|| format!("parse config {} as JSON", path.display()))
}

fn apply_file_config(config: &mut CliConfig, file: &FileConfig) -> Result<()> {
    if let Some(value) = &file.node_id {
        config.node_id = value.clone();
    }
    if let Some(value) = &file.router_url {
        config.router_url = value.clone();
    }
    if let Some(value) = &file.address {
        config.address = parse_address(value)?;
    }
    if let Some(value) = &file.web_addr {
        config.web_addr = value.clone();
    }
    if let Some(value) = file.no_web {
        config.no_web = value;
    }
    if let Some(value) = file.seed_demo {
        config.seed_demo = value;
    }
    Ok(())
}

pub fn validate_config(config: &CliConfig) -> Result<()> {
    if config.node_id.trim().is_empty() {
        bail!("nodeId/node_id is required");
    }
    if config.router_url.trim().is_empty() {
        bail!("routerUrl/router_url is required");
    }
    if !config.no_web && config.web_addr.trim().is_empty() {
        bail!("webAddr/web_addr is required");
    }
    config
        .address
        .validate()
        .map_err(|error| anyhow::anyhow!(error.to_string()))
}

fn take_value(args: &mut impl Iterator<Item = String>, flag: &str) -> Result<String> {
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

pub fn format_address(address: &SessionAddress) -> String {
    match (&address.runtime, &address.session) {
        (Some(runtime), Some(session)) => format!("{}/{}/{}", address.domain, runtime, session),
        (Some(runtime), None) => format!("{}/{}/*", address.domain, runtime),
        (None, Some(session)) => format!("{}/*/{}", address.domain, session),
        (None, None) => format!("{}/*/*", address.domain),
    }
}

fn print_help() {
    println!(
        "Usage: requestion-endpoint [OPTIONS]\n\
         \n\
         Options:\n\
         \x20   --config <path>         JSON config file path (hot reload source)\n\
         \x20   --router-url <ws-url>   Router WebSocket URL override [default: ws://127.0.0.1:7200]\n\
         \x20   --node-id <id>          Node ID [default: requestion-endpoint]\n\
         \x20   --address <d/r/s>       Endpoint address [default: domain-a/requestion-endpoint/requestion-endpoint]\n\
         \x20   --web-addr <host:port>  Web/MCP API listen address [default: 127.0.0.1:7318]\n\
         \x20   --no-web                Disable Web/MCP API server\n\
         \x20   --seed-demo             Seed cache with synthetic requestion data (demo only)\n\
         \x20   -h, --help              Show this help"
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn default_config_has_no_file_dependency() {
        let config = default_config();
        assert_eq!(config.router_url, "ws://127.0.0.1:7200");
        assert_eq!(
            format_address(&config.address),
            "domain-a/requestion-endpoint/requestion-endpoint"
        );
        assert!(config.config_path.is_none());
        validate_config(&config).unwrap();
    }

    #[test]
    fn reload_from_config_file_updates_runtime_fields() {
        let path = temp_config_path();
        fs::write(
            &path,
            r#"{
            "nodeId":"requestion-test",
            "routerUrl":"ws://127.0.0.1:7209",
            "address":"domain-a/requestion-test/ses-test",
            "webAddr":"127.0.0.1:17318",
            "noWeb":false,
            "seedDemo":false
        }"#,
        )
        .unwrap();
        let mut config = default_config();
        config.config_path = Some(path.clone());

        let reloaded = reload_from_config_path(&config).unwrap();

        assert_eq!(reloaded.node_id, "requestion-test");
        assert_eq!(reloaded.router_url, "ws://127.0.0.1:7209");
        assert_eq!(
            format_address(&reloaded.address),
            "domain-a/requestion-test/ses-test"
        );
        let _ = fs::remove_file(path);
    }

    #[test]
    fn invalid_config_file_is_rejected() {
        let path = temp_config_path();
        fs::write(&path, r#"{"routerUrl":""}"#).unwrap();
        let mut config = default_config();
        config.config_path = Some(path.clone());
        let error = reload_from_config_path(&config).unwrap_err().to_string();
        assert!(error.contains("routerUrl"));
        let _ = fs::remove_file(path);
    }

    fn temp_config_path() -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        env::temp_dir().join(format!("requestion-config-{stamp}.json"))
    }
}
