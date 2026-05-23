use anyhow::Result;
use serde_json::{json, Value};

use crate::state::model::*;

impl AppState {
    pub(super) async fn list_chats(&self, a: Value) -> Result<Value> {
        let prefix = format!(
            "{}::{}::",
            str_arg(&a, "provider")?.to_lowercase(),
            str_arg(&a, "accountID")?
        );
        let vals: Vec<Value> = self
            .inner
            .lock()
            .await
            .chats
            .iter()
            .filter(|(k, _)| k.starts_with(&prefix))
            .map(|(_, v)| v.clone())
            .collect();
        Ok(json!({"count":vals.len(),"items":vals}))
    }
    pub(super) async fn create_chat(&self, a: Value) -> Result<Value> {
        let provider = str_arg(&a, "provider")?.to_lowercase();
        let account = str_arg(&a, "accountID")?;
        self.require_account(&provider, account).await?;
        let chat = s(&a, "uuid");
        let chat_id = if chat.is_empty() {
            format!("chat_{}", now_ms())
        } else {
            chat
        };
        let item = chat_value(
            &provider,
            account,
            &chat_id,
            str_arg(&a, "name")?,
            s(&a, "description"),
        );
        let mut m = self.inner.lock().await;
        m.chats
            .insert(chat_key(&provider, account, &chat_id), item.clone());
        m.members.insert(
            chat_key(&provider, account, &chat_id),
            ids_to_members(a.get("userIDs"), "user_id"),
        );
        Ok(item)
    }
    pub(super) async fn delete_chat(&self, a: Value) -> Result<Value> {
        let key = chat_key(
            &str_arg(&a, "provider")?.to_lowercase(),
            str_arg(&a, "accountID")?,
            str_arg(&a, "chatID")?,
        );
        let mut m = self.inner.lock().await;
        m.chats.remove(&key);
        m.members.remove(&key);
        Ok(json!({"ok":true}))
    }
    pub(super) async fn list_members(&self, a: Value) -> Result<Value> {
        let key = chat_key(
            &str_arg(&a, "provider")?.to_lowercase(),
            str_arg(&a, "accountID")?,
            str_arg(&a, "chatID")?,
        );
        let items = self
            .inner
            .lock()
            .await
            .members
            .get(&key)
            .cloned()
            .unwrap_or_default();
        Ok(json!({"chatID":str_arg(&a,"chatID")?,"total":items.len(),"items":items}))
    }
    pub(super) async fn add_members(&self, a: Value) -> Result<Value> {
        let key = chat_key(
            &str_arg(&a, "provider")?.to_lowercase(),
            str_arg(&a, "accountID")?,
            str_arg(&a, "chatID")?,
        );
        let mut m = self.inner.lock().await;
        let rows = m.members.entry(key).or_default();
        let typ = s_or(&a, "memberIDType", "user_id");
        for id in strings(a.get("memberIDs")) {
            if !rows.iter().any(|x| x["memberID"] == id) {
                rows.push(json!({"memberIDType":typ,"memberID":id,"name":id,"tenantKey":"local"}));
            }
        }
        Ok(json!({"invalidIDs":[],"notExistedIDs":[],"pendingApprovalIDs":[]}))
    }
}
