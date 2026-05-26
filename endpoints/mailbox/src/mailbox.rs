use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Arc};
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailboxItem {
    pub item_id: String,
    pub replay_id: Option<String>,
    pub recipient_runtime_id: String,
    pub recipient_session_id: String,
    pub sender_runtime_id: String,
    pub sender_session_id: String,
    pub sender_session_title: String,
    pub info_type: String,
    pub title: String,
    pub content: String,
    pub has_read: bool,
    pub created_at_ms: u128,
}

#[derive(Debug, Clone, Default)]
pub struct MailboxStore(Arc<Mutex<HashMap<String, Vec<MailboxItem>>>>);

impl MailboxStore {
    pub async fn list(&self, args: &Value) -> Value {
        let session_id = string_arg(args, "ExecutorSessionID");
        let runtime_id = executor_runtime(args);
        let size = number_arg(args, "size", 10);
        let regex = string_arg(args, "regex").unwrap_or_default();
        let meta_regex = string_arg(args, "metadataRegex").unwrap_or_default();
        let mut rows = self.matching_rows(&runtime_id, session_id.as_deref()).await;
        rows.retain(|row| text_match(&regex, &format!("{}\n{}", row.title, row.content)));
        rows.retain(|row| text_match(&meta_regex, &metadata_text(row)));
        rows.sort_by(|a, b| b.created_at_ms.cmp(&a.created_at_ms));
        let list: Vec<Value> = rows.iter().take(size).map(summary_json).collect();
        json!({ "realsize": rows.len(), "list": list })
    }

    pub async fn read(&self, args: &Value) -> Value {
        let item_id = string_arg(args, "itemID").unwrap_or_default();
        let executor_session = string_arg(args, "ExecutorSessionID").unwrap_or_default();
        let executor_runtime = executor_runtime(args);
        let mut buckets = self.0.lock().await;
        for (session, rows) in buckets.iter_mut() {
            if !executor_session.is_empty() && session != &executor_session {
                continue;
            }
            if let Some(row) = rows.iter_mut().find(|row| row.item_id == item_id) {
                if !executor_runtime.is_empty() && row.recipient_runtime_id != executor_runtime {
                    continue;
                }
                row.has_read = true;
                return full_json(row);
            }
        }
        json!(null)
    }

    pub async fn send(&self, args: &Value) -> Value {
        let recipient_runtime_id = required_string(args, "runtimeID", "recipient-runtime");
        let recipient_session_id = required_string(args, "sessionID", "recipient-session");
        let executor_session_id = required_string(args, "ExecutorSessionID", "mailbox-endpoint");
        let executor_runtime_id = executor_runtime(args);
        let info_type = match string_arg(args, "type").as_deref() {
            Some("NeedReplay") => "NeedReplay",
            _ => "Notice",
        };
        let row = MailboxItem {
            item_id: Uuid::new_v4().to_string(),
            replay_id: (info_type == "NeedReplay").then(|| Uuid::new_v4().to_string()),
            recipient_runtime_id,
            recipient_session_id: recipient_session_id.clone(),
            sender_runtime_id: if executor_runtime_id.is_empty() {
                "mailbox-endpoint".into()
            } else {
                executor_runtime_id
            },
            sender_session_id: executor_session_id,
            sender_session_title: required_string(args, "senderSessionTitle", "Mailbox Endpoint"),
            info_type: info_type.into(),
            title: required_string(args, "title", "Untitled"),
            content: required_string(args, "msg", ""),
            has_read: false,
            created_at_ms: now_ms(),
        };
        let id = row.item_id.clone();
        let replay_id = row.replay_id.clone();
        self.0
            .lock()
            .await
            .entry(recipient_session_id)
            .or_default()
            .push(row);
        json!({ "ok": true, "itemID": id, "replayID": replay_id })
    }

    pub async fn reply(&self, args: &Value) -> Value {
        let replay_id = string_arg(args, "replayID").unwrap_or_default();
        let message = required_string(args, "msg", "");
        let executor_session = string_arg(args, "ExecutorSessionID").unwrap_or_default();
        let executor_runtime = executor_runtime(args);
        let mut buckets = self.0.lock().await;
        let mut reply = None;
        for (session, rows) in buckets.iter_mut() {
            if !executor_session.is_empty() && session != &executor_session {
                continue;
            }
            if let Some(row) = rows.iter_mut().find(|row| {
                row.replay_id.as_deref() == Some(&replay_id) && row.info_type == "NeedReplay"
            }) {
                if !executor_runtime.is_empty() && row.recipient_runtime_id != executor_runtime {
                    continue;
                }
                row.info_type = "Replaied".into();
                reply = Some((
                    row.sender_session_id.clone(),
                    make_reply(row, &message, args),
                ));
                break;
            }
        }
        if let Some((target_session, row)) = reply {
            let id = row.item_id.clone();
            buckets.entry(target_session).or_default().push(row);
            return json!({ "ok": true, "replayMailID": id });
        }
        json!({ "ok": false, "message": "ReplayID not found" })
    }

    pub async fn delete(&self, args: &Value) -> Value {
        let item_id = string_arg(args, "itemID").unwrap_or_default();
        let executor_session = string_arg(args, "ExecutorSessionID").unwrap_or_default();
        let executor_runtime = executor_runtime(args);
        let mut buckets = self.0.lock().await;
        for (session, rows) in buckets.iter_mut() {
            if !executor_session.is_empty() && session != &executor_session {
                continue;
            }
            if let Some(index) = rows.iter().position(|row| row.item_id == item_id) {
                if !executor_runtime.is_empty()
                    && rows[index].recipient_runtime_id != executor_runtime
                {
                    continue;
                }
                rows.remove(index);
                return json!({ "ok": true, "itemID": item_id, "message": "deleted" });
            }
        }
        json!({ "ok": false, "itemID": item_id, "message": "item not found" })
    }

    pub async fn reminders(&self, args: &Value) -> Value {
        let mut rows = self
            .matching_rows(
                &executor_runtime(args),
                string_arg(args, "ExecutorSessionID").as_deref(),
            )
            .await;
        rows.retain(|row| row.info_type == "NeedReplay" && !row.has_read);
        rows.sort_by(|a, b| b.created_at_ms.cmp(&a.created_at_ms));
        json!({ "count": rows.len(), "list": rows.iter().map(summary_json).collect::<Vec<_>>() })
    }

    async fn matching_rows(&self, runtime_id: &str, session_id: Option<&str>) -> Vec<MailboxItem> {
        let buckets = self.0.lock().await;
        if let Some(session) = session_id.filter(|value| !value.is_empty()) {
            return buckets.get(session).cloned().unwrap_or_default();
        }
        buckets
            .values()
            .flatten()
            .filter(|row| runtime_id.is_empty() || row.recipient_runtime_id == runtime_id)
            .cloned()
            .collect()
    }
}

fn make_reply(original: &MailboxItem, message: &str, args: &Value) -> MailboxItem {
    let executor_runtime = executor_runtime(args);
    MailboxItem {
        item_id: Uuid::new_v4().to_string(),
        replay_id: original.replay_id.clone(),
        recipient_runtime_id: original.sender_runtime_id.clone(),
        recipient_session_id: original.sender_session_id.clone(),
        sender_runtime_id: if executor_runtime.is_empty() {
            "mailbox-endpoint".into()
        } else {
            executor_runtime
        },
        sender_session_id: required_string(args, "ExecutorSessionID", "mailbox-endpoint"),
        sender_session_title: required_string(args, "senderSessionTitle", "Mailbox Endpoint"),
        info_type: "QuestReply".into(),
        title: format!("Reply: {}", original.title),
        content: message.into(),
        has_read: false,
        created_at_ms: now_ms(),
    }
}

fn summary_json(row: &MailboxItem) -> Value {
    json!({ "ItemID": row.item_id, "ReplayID": row.replay_id, "senderSessionID": row.sender_session_id, "senderSessionTitle": row.sender_session_title, "InfoType": info_type(row), "hasRead": row.has_read, "title": row.title, "times": row.created_at_ms })
}

fn full_json(row: &MailboxItem) -> Value {
    json!({ "ItemID": row.item_id, "ReplayID": row.replay_id, "senderRuntimeID": row.sender_runtime_id, "senderSessionID": row.sender_session_id, "senderSessionTitle": row.sender_session_title, "InfoType": info_type(row), "hasRead": row.has_read, "title": row.title, "content": row.content, "times": row.created_at_ms })
}

fn info_type(row: &MailboxItem) -> String {
    if row.info_type == "QuestReply" {
        return format!("QuestReply({})", row.replay_id.clone().unwrap_or_default());
    }
    row.info_type.clone()
}

fn metadata_text(row: &MailboxItem) -> String {
    format!(
        "{}\n{}\n{}\n{}\n{}",
        row.created_at_ms,
        info_type(row),
        row.has_read,
        row.sender_session_id,
        row.sender_session_title
    )
}

fn text_match(pattern: &str, text: &str) -> bool {
    pattern.is_empty() || text.contains(pattern)
}

fn string_arg(args: &Value, key: &str) -> Option<String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
}

fn executor_runtime(args: &Value) -> String {
    string_arg(args, "ExecutorRuntimeID")
        .or_else(|| string_arg(args, "executorRuntimeID"))
        .unwrap_or_default()
}

fn required_string(args: &Value, key: &str, fallback: &str) -> String {
    string_arg(args, key).unwrap_or_else(|| fallback.into())
}

fn number_arg(args: &Value, key: &str, fallback: usize) -> usize {
    args.get(key)
        .and_then(Value::as_u64)
        .map(|v| v as usize)
        .unwrap_or(fallback)
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}
