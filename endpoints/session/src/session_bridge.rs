use crate::{mailbox::MailboxStore, state::SharedState};
use anyhow::{bail, Result};
use serde_json::{json, Value};

#[derive(Clone, Debug, Default)]
pub struct BridgeServices {
    mailbox: MailboxStore,
}

impl BridgeServices {
    pub fn new() -> Self {
        Self::default()
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
            "ListMailboxItems" => self.mailbox.list(&args).await,
            "ReadMailboxItem" => self.mailbox.read(&args).await,
            "SendMailboxItem" => self.mailbox.send(&args).await,
            "ReplyMailboxItem" => self.mailbox.reply(&args).await,
            "DeleteMailboxItem" => self.mailbox.delete(&args).await,
            _ => return Ok(None),
        };
        Ok(Some(value))
    }
}

pub fn bridge_tool_names() -> &'static [&'static str] {
    &[
        "ListLivingSessions",
        "GetSessionMessages",
        "ListMailboxItems",
        "ReadMailboxItem",
        "SendMailboxItem",
        "ReplyMailboxItem",
        "DeleteMailboxItem",
    ]
}

pub fn bridge_tool_schema(name: &str) -> Option<Value> {
    let executor =
        json!({ "type": "string", "pattern": "\\S", "description": "Executor/caller sessionID" });
    let executor_runtime = json!({ "type": "string", "description": "Optional executor/caller runtimeID when not provided by host" });
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
        "ListMailboxItems" => Some(json!({
            "type": "object",
            "properties": { "ExecutorSessionID": executor, "ExecutorRuntimeID": executor_runtime, "size": { "type": "number" }, "regex": { "type": "string" }, "metadataRegex": { "type": "string" } },
            "required": ["ExecutorSessionID"], "additionalProperties": true
        })),
        "ReadMailboxItem" | "DeleteMailboxItem" => Some(json!({
            "type": "object",
            "properties": { "ExecutorSessionID": executor, "ExecutorRuntimeID": executor_runtime, "itemID": { "type": "string", "pattern": "\\S" } },
            "required": ["ExecutorSessionID", "itemID"], "additionalProperties": true
        })),
        "SendMailboxItem" => Some(json!({
            "type": "object",
            "properties": { "ExecutorSessionID": executor, "ExecutorRuntimeID": executor_runtime, "runtimeID": { "type": "string", "pattern": "\\S", "description": "Target runtimeID" }, "sessionID": { "type": "string", "pattern": "\\S", "description": "Target sessionID" }, "title": { "type": "string", "pattern": "\\S" }, "msg": { "type": "string", "pattern": "\\S" }, "type": { "type": "string", "enum": ["Notice", "NeedReplay"] } },
            "required": ["ExecutorSessionID", "runtimeID", "sessionID", "title", "msg"], "additionalProperties": true
        })),
        "ReplyMailboxItem" => Some(json!({
            "type": "object",
            "properties": { "ExecutorSessionID": executor, "ExecutorRuntimeID": executor_runtime, "replayID": { "type": "string", "pattern": "\\S" }, "msg": { "type": "string", "pattern": "\\S" } },
            "required": ["ExecutorSessionID", "replayID", "msg"], "additionalProperties": true
        })),
        _ => None,
    }
}

fn validate_args(name: &str, args: &Value) -> Result<()> {
    let required: &[&str] = match name {
        "ListLivingSessions" | "ListMailboxItems" => &["ExecutorSessionID"],
        "ReadMailboxItem" | "DeleteMailboxItem" => &["ExecutorSessionID", "itemID"],
        "SendMailboxItem" => &[
            "ExecutorSessionID",
            "runtimeID",
            "sessionID",
            "title",
            "msg",
        ],
        "ReplyMailboxItem" => &["ExecutorSessionID", "replayID", "msg"],
        "GetSessionMessages" => &[],
        _ => return Ok(()),
    };
    for key in required {
        if args
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("")
            .is_empty()
        {
            bail!("{name} requires {key}");
        }
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
            "title": "session-endpoint",
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
