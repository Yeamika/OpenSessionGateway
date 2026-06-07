//! Configuration management for Timer endpoint

use anyhow::{bail, Context, Result};
use serde::Deserialize;
use std::path::Path;

/// Main configuration structure
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub listen: ListenConfig,
    pub gv: GvConfig,
}

/// Listen configuration
#[derive(Debug, Clone, Deserialize)]
pub struct ListenConfig {
    pub host: String,
    pub port: u16,
}

/// GlassVein configuration
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GvConfig {
    pub router_url: Option<String>,
    pub domain: String,
    #[serde(rename = "runtimeID")]
    pub runtime_id: String,
    /// Peer identity for `LinkHandshake`. Defaults to `runtime_id` if not set.
    #[serde(default)]
    pub peer_id: Option<String>,
    #[serde(rename = "sessionID")]
    pub session_id: String,
    pub source_runtime: String,
    pub source_session: String,
}

/// Default configuration values.
pub fn default_config() -> Config {
    Config {
        listen: ListenConfig {
            host: "127.0.0.1".to_string(),
            port: 8789,
        },
        gv: GvConfig {
            router_url: Some("ws://127.0.0.1:7200".to_string()),
            domain: "domain-a".to_string(),
            runtime_id: "timer-endpoint".to_string(),
            peer_id: None, // defaults to runtime_id in handshake code
            session_id: "timer".to_string(),
            source_runtime: "timer-endpoint".to_string(),
            source_session: "timer".to_string(),
        },
    }
}

/// CLI arguments parsed from the command line.
#[derive(Debug, Clone)]
pub struct CliArgs {
    pub config_path: Option<String>,
}

/// Parse CLI arguments (skip binary name).
pub fn parse_args(args: impl Iterator<Item = String>) -> CliArgs {
    let mut config_path = None;
    let mut args = args.peekable();
    while let Some(arg) = args.next() {
        if arg == "--config" {
            config_path = args.next();
        } else if arg.starts_with("--config=") {
            config_path = arg.strip_prefix("--config=").map(String::from);
        }
    }
    CliArgs { config_path }
}

/// Load configuration from file path
pub fn load_config(path: Option<&str>) -> Result<Config> {
    match path {
        Some(config_path) => {
            let path = Path::new(config_path);
            if !path.exists() {
                bail!("Configuration file not found: {}", config_path);
            }

            let content = std::fs::read_to_string(path)
                .with_context(|| format!("Failed to read config file: {}", config_path))?;

            let config: Config = serde_json::from_str(&content)
                .with_context(|| format!("Failed to parse config file: {}", config_path))?;

            Ok(config)
        }
        None => Ok(default_config()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = default_config();
        assert_eq!(config.listen.host, "127.0.0.1");
        assert_eq!(config.listen.port, 8789);
        assert_eq!(config.gv.runtime_id, "timer-endpoint");
    }

    #[test]
    fn test_load_config_from_json() {
        let json = r#"{
            "listen": { "host": "0.0.0.0", "port": 9000 },
            "gv": {
                "routerUrl": "ws://localhost:7200",
                "domain": "test-domain",
                "runtimeID": "test-runtime",
                "sessionID": "test-session",
                "sourceRuntime": "test-source",
                "sourceSession": "test-source-session"
            }
        }"#;

        let config: Config = serde_json::from_str(json).unwrap();
        assert_eq!(config.listen.host, "0.0.0.0");
        assert_eq!(config.listen.port, 9000);
        assert_eq!(config.gv.domain, "test-domain");
    }

    #[test]
    fn test_load_config_none_path() {
        let config = load_config(None).unwrap();
        assert_eq!(config.listen.port, 8789);
    }

    #[test]
    fn test_load_config_missing_file() {
        let result = load_config(Some("/nonexistent/config.json"));
        assert!(result.is_err());
    }

    #[test]
    fn test_config_peer_id_optional() {
        let json = r#"{
            "listen": { "host": "127.0.0.1", "port": 8789 },
            "gv": {
                "routerUrl": "ws://localhost:7200",
                "domain": "test-domain",
                "runtimeID": "test-runtime",
                "sessionID": "test-session",
                "sourceRuntime": "test-source",
                "sourceSession": "test-source-session"
            }
        }"#;

        let config: Config = serde_json::from_str(json).unwrap();
        assert_eq!(config.gv.peer_id, None, "peer_id should default to None");

        // With explicit peer_id
        let json_with_peer = json.replace(
            "\"sourceSession\": \"test-source-session\"",
            "\"sourceSession\": \"test-source-session\",\n                \"peerId\": \"my-timer-peer\"",
        );
        let config2: Config = serde_json::from_str(&json_with_peer).unwrap();
        assert_eq!(
            config2.gv.peer_id,
            Some("my-timer-peer".to_string()),
            "peer_id should be parsed when present"
        );
    }
}
