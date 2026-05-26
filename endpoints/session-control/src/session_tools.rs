use crate::state::SharedState;
use anyhow::{bail, Result};
use serde_json::{json, Value};

#[derive(Clone, Debug, Default)]
pub struct SessionToolServices;

impl SessionToolServices {
    pub fn new() -> Self {
        Self
    }

    pub async fn call(
        &self,
        name: &str,
        args: Value,
        state: &SharedState,
    ) -> Result<Option<Value>> {
        validate_args(name, &args)?;
        let value = match name {
            "ListLivingSessions" => list_living_sessions(state, &args).await,
            "GetSessionMessages" => get_session_messages(state, &args).await,
            _ => return Ok(None),
        };
        Ok(Some(value))
    }
}

pub fn session_tool_names() -> &'static [&'static str] {
    &["ListLivingSessions", "GetSessionMessages"]
}

pub fn session_tool_schema(name: &str) -> Option<Value> {
    let executor =
        json!({ "type": "string", "pattern": "\\S", "description": "Executor/caller sessionID" });
    match name {
        "ListLivingSessions" => Some(json!({
            "type": "object",
            "properties": { "ExecutorSessionID": executor, "list": { "type": "number" }, "regex": { "type": "string" } },
            "required": ["ExecutorSessionID"], "additionalProperties": true
        })),
        "GetSessionMessages" => Some(json!({
            "type": "object",
            "properties": { "runtimeID": { "type": "string", "pattern": "\\S" }, "sessionID": { "type": "string", "pattern": "\\S" }, "size": { "type": "number" }, "limit": { "type": "number" }, "regex": { "type": "string" }, "anchorTime": { "type": "string" } },
            "required": [], "additionalProperties": true
        })),
        _ => None,
    }
}

fn validate_args(name: &str, args: &Value) -> Result<()> {
    if name == "ListLivingSessions"
        && args
            .get("ExecutorSessionID")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("")
            .is_empty()
    {
        bail!("{name} requires ExecutorSessionID");
    }
    Ok(())
}

async fn list_living_sessions(state: &SharedState, args: &Value) -> Value {
    let snapshot = state.snapshot().await;
    let limit = args.get("list").and_then(Value::as_u64).unwrap_or(10) as usize;
    let regex = args.get("regex").and_then(Value::as_str).unwrap_or("");
    let mut rows = Vec::new();
    if let Some(config) = snapshot.config {
        rows.push(json!({
            "runtimeID": config.target.runtime.clone().unwrap_or_default(),
            "title": snapshot.summary.get("title").and_then(Value::as_str).unwrap_or(""),
            "sessionID": config.target.session.clone().unwrap_or_default(),
            "sessionState": snapshot.summary.get("state").cloned().unwrap_or(Value::Null),
            "sessionReason": null,
            "sessionMeta": snapshot.summary,
            "lastActiveTime": snapshot.updates.first().map(|item| item.at_ms),
            "activeCount": snapshot.updates.len(),
        }));
        rows.push(json!({
            "runtimeID": config.source.runtime.clone().unwrap_or_default(),
            "title": "session-control-endpoint",
            "sessionID": config.source.session.clone().unwrap_or_default(),
            "sessionState": snapshot.status,
            "sessionReason": snapshot.last_error,
            "sessionMeta": {},
            "lastActiveTime": snapshot.logs.first().map(|item| item.at_ms),
            "activeCount": snapshot.logs.len(),
        }));
    }
    rows.retain(|row| regex.is_empty() || row.to_string().contains(regex));
    json!({ "realsize": rows.len(), "list": rows.into_iter().take(limit).collect::<Vec<_>>() })
}

async fn get_session_messages(state: &SharedState, args: &Value) -> Value {
    let snapshot = state.snapshot().await;
    let limit = args
        .get("size")
        .or_else(|| args.get("limit"))
        .and_then(Value::as_u64)
        .unwrap_or(20) as usize;
    let regex = args.get("regex").and_then(Value::as_str).unwrap_or("");
    let mut messages: Vec<Value> =
        snapshot
            .logs
            .into_iter()
            .map(|item| json!({ "time": item.at_ms, "type": item.label, "payload": item.payload }))
            .chain(snapshot.updates.into_iter().map(
                |item| json!({ "time": item.at_ms, "type": item.label, "payload": item.payload }),
            ))
            .filter(|row| regex.is_empty() || row.to_string().contains(regex))
            .collect();
    messages.sort_by(|a, b| {
        b.get("time")
            .and_then(Value::as_u64)
            .cmp(&a.get("time").and_then(Value::as_u64))
    });
    json!({ "realsize": messages.len(), "list": messages.into_iter().take(limit).collect::<Vec<_>>() })
}
