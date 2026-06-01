use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::VecDeque, sync::Arc};
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeConfig {
    pub listen: String,
    pub executor_runtime_id: Option<String>,
    pub executor_session_id: Option<String>,
    pub web_defaults: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailboxEvent {
    pub at_ms: u128,
    pub label: String,
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublicState {
    pub status: String,
    pub last_error: String,
    pub runtime_config: Option<RuntimeConfig>,
    pub router_status: String,
    pub logs: Vec<MailboxEvent>,
}

#[derive(Debug)]
struct StateInner {
    status: String,
    last_error: String,
    runtime_config: Option<RuntimeConfig>,
    router_status: String,
    logs: VecDeque<MailboxEvent>,
}

#[derive(Clone, Debug)]
pub struct SharedState(Arc<Mutex<StateInner>>);

impl SharedState {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(StateInner {
            status: "ready".into(),
            last_error: String::new(),
            runtime_config: None,
            router_status: "disconnected".into(),
            logs: VecDeque::new(),
        })))
    }

    pub async fn snapshot(&self) -> PublicState {
        let inner = self.0.lock().await;
        PublicState {
            status: inner.status.clone(),
            last_error: inner.last_error.clone(),
            runtime_config: inner.runtime_config.clone(),
            router_status: inner.router_status.clone(),
            logs: inner.logs.iter().cloned().collect(),
        }
    }

    pub async fn set_runtime_config(&self, config: RuntimeConfig) {
        self.0.lock().await.runtime_config = Some(config);
    }

    pub async fn set_router_status(&self, status: impl Into<String>) {
        self.0.lock().await.router_status = status.into();
    }

    pub async fn log(&self, label: impl Into<String>, payload: Value) {
        let mut inner = self.0.lock().await;
        inner.logs.push_front(MailboxEvent {
            at_ms: now_ms(),
            label: label.into(),
            payload,
        });
        while inner.logs.len() > 120 {
            inner.logs.pop_back();
        }
    }
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}
