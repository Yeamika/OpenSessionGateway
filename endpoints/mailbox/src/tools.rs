use crate::mailbox::MailboxStore;
use anyhow::{bail, Result};
use serde_json::{json, Value};

#[derive(Clone, Debug, Default)]
pub struct MailboxToolServices {
    mailbox: MailboxStore,
}

impl MailboxToolServices {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn call(&self, name: &str, args: Value) -> Result<Option<Value>> {
        validate_args(name, &args)?;
        let value = match name {
            "ListMailboxItems" => self.mailbox.list(&args).await,
            "ReadMailboxItem" => self.mailbox.read(&args).await,
            "SendMailboxItem" => self.mailbox.send(&args).await,
            "ReplyMailboxItem" => self.mailbox.reply(&args).await,
            "DeleteMailboxItem" => self.mailbox.delete(&args).await,
            "MailboxReminders" => self.mailbox.reminders(&args).await,
            _ => return Ok(None),
        };
        Ok(Some(value))
    }
}

pub fn mailbox_tool_names() -> &'static [&'static str] {
    &[
        "ListMailboxItems",
        "ReadMailboxItem",
        "SendMailboxItem",
        "ReplyMailboxItem",
        "DeleteMailboxItem",
        "MailboxReminders",
    ]
}

pub fn mailbox_tool_schema(name: &str) -> Option<Value> {
    let executor = json!({ "type": "string", "pattern": "\\S", "description": "Executor/caller mailbox bucket sessionID" });
    let executor_runtime =
        json!({ "type": "string", "description": "Optional executor/caller runtimeID" });
    match name {
        "ListMailboxItems" | "MailboxReminders" => Some(json!({
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
        "ListMailboxItems" | "MailboxReminders" => &["ExecutorSessionID"],
        "ReadMailboxItem" | "DeleteMailboxItem" => &["ExecutorSessionID", "itemID"],
        "SendMailboxItem" => &[
            "ExecutorSessionID",
            "runtimeID",
            "sessionID",
            "title",
            "msg",
        ],
        "ReplyMailboxItem" => &["ExecutorSessionID", "replayID", "msg"],
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
