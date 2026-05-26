use osgp::SessionAddress;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::VecDeque, sync::Arc};
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EndpointConfig {
    pub router_url: String,
    pub node_id: String,
    pub source: SessionAddress,
    pub target: SessionAddress,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeConfig {
    pub listen: String,
    pub endpoint: EndpointConfig,
    pub executor_runtime_id: Option<String>,
    pub executor_session_id: Option<String>,
    pub web_defaults: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionEvent {
    pub at_ms: u128,
    pub label: String,
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublicState {
    pub status: String,
    pub last_error: String,
    pub config: Option<EndpointConfig>,
    pub runtime_config: Option<RuntimeConfig>,
    pub summary: Value,
    pub updates: Vec<SessionEvent>,
    pub logs: Vec<SessionEvent>,
}

#[derive(Debug)]
struct StateInner {
    status: String,
    last_error: String,
    config: Option<EndpointConfig>,
    runtime_config: Option<RuntimeConfig>,
    summary: Value,
    updates: VecDeque<SessionEvent>,
    logs: VecDeque<SessionEvent>,
}

#[derive(Clone, Debug)]
pub struct SharedState(Arc<Mutex<StateInner>>);

impl SharedState {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(StateInner {
            status: "disconnected".into(),
            last_error: String::new(),
            config: None,
            runtime_config: None,
            summary: Value::Object(Default::default()),
            updates: VecDeque::new(),
            logs: VecDeque::new(),
        })))
    }

    pub async fn snapshot(&self) -> PublicState {
        let inner = self.0.lock().await;
        PublicState {
            status: inner.status.clone(),
            last_error: inner.last_error.clone(),
            config: inner.config.clone(),
            runtime_config: inner.runtime_config.clone(),
            summary: inner.summary.clone(),
            updates: inner.updates.iter().cloned().collect(),
            logs: inner.logs.iter().cloned().collect(),
        }
    }

    pub async fn set_status(&self, status: &str, error: impl Into<String>) {
        let mut inner = self.0.lock().await;
        inner.status = status.into();
        inner.last_error = error.into();
    }

    pub async fn set_config(&self, config: EndpointConfig) {
        self.0.lock().await.config = Some(config);
    }

    pub async fn set_runtime_config(&self, config: RuntimeConfig) {
        let mut inner = self.0.lock().await;
        inner.config = Some(config.endpoint.clone());
        inner.runtime_config = Some(config);
    }

    pub async fn log(&self, label: impl Into<String>, payload: Value) {
        let mut inner = self.0.lock().await;
        push(&mut inner.logs, label.into(), payload, 120);
    }

    pub async fn session_update(&self, payload: Value) {
        let mut inner = self.0.lock().await;
        merge_summary(&mut inner.summary, &payload);
        push(&mut inner.updates, "session_update".into(), payload, 100);
    }
}

fn push(queue: &mut VecDeque<SessionEvent>, label: String, payload: Value, max: usize) {
    queue.push_front(SessionEvent {
        at_ms: now_ms(),
        label,
        payload,
    });
    while queue.len() > max {
        queue.pop_back();
    }
}

fn merge_summary(summary: &mut Value, payload: &Value) {
    let Some(target) = summary.as_object_mut() else {
        return;
    };
    let Some(source) = payload.as_object() else {
        return;
    };
    for key in [
        "sessionId",
        "state",
        "title",
        "summary",
        "runtime",
        "workspace",
    ] {
        if let Some(value) = source.get(key) {
            target.insert(key.into(), value.clone());
        }
    }
    target.insert("updatedAtMs".into(), Value::from(now_ms() as u64));
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}
