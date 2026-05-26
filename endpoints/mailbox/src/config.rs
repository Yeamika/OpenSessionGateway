use crate::{state::RuntimeConfig, state::SharedState};
use anyhow::{Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{net::SocketAddr, path::PathBuf, sync::Arc};
use tokio::sync::Mutex;

#[derive(Debug, Clone)]
pub struct ConfigStore {
    path: Arc<Mutex<Option<PathBuf>>>,
    listen_override: Option<SocketAddr>,
}

#[derive(Debug, Deserialize, Default)]
struct FileConfig {
    listen: Option<String>,
    executor: Option<ExecutorConfig>,
    web_defaults: Option<Value>,
}

#[derive(Debug, Deserialize, Default)]
struct ExecutorConfig {
    runtime_id: Option<String>,
    session_id: Option<String>,
}

impl ConfigStore {
    pub fn new(path: Option<PathBuf>, listen_override: Option<SocketAddr>) -> Self {
        Self {
            path: Arc::new(Mutex::new(path)),
            listen_override,
        }
    }

    pub async fn load_initial(&self, state: &SharedState) -> Result<RuntimeConfig> {
        let config = self.read_config().await?;
        state.set_runtime_config(config.clone()).await;
        Ok(config)
    }

    pub async fn reload(&self, state: &SharedState) -> Result<Value> {
        let config = self.read_config().await?;
        state.set_runtime_config(config.clone()).await;
        state
            .log("config_reloaded", serde_json::to_value(&config)?)
            .await;
        Ok(json!({ "ok": true, "config": config }))
    }

    async fn read_config(&self) -> Result<RuntimeConfig> {
        let path = self.effective_path().await;
        let file = match path {
            Some(path) if path.exists() => {
                let text = std::fs::read_to_string(&path)
                    .with_context(|| format!("read config {}", path.display()))?;
                serde_json::from_str::<FileConfig>(&text)
                    .with_context(|| format!("parse config {}", path.display()))?
            }
            _ => FileConfig::default(),
        };
        Ok(runtime_config(file, self.listen_override))
    }

    async fn effective_path(&self) -> Option<PathBuf> {
        if let Some(path) = self.path.lock().await.clone() {
            return Some(path);
        }
        let local = PathBuf::from("endpoints/mailbox/config.local.json");
        local.exists().then_some(local)
    }
}

fn runtime_config(file: FileConfig, listen_override: Option<SocketAddr>) -> RuntimeConfig {
    RuntimeConfig {
        listen: listen_override
            .map(|value| value.to_string())
            .or(file.listen)
            .unwrap_or_else(|| "127.0.0.1:7311".into()),
        executor_runtime_id: file.executor.as_ref().and_then(|v| v.runtime_id.clone()),
        executor_session_id: file.executor.as_ref().and_then(|v| v.session_id.clone()),
        web_defaults: file.web_defaults.unwrap_or_else(|| json!({})),
    }
}
