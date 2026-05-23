use anyhow::{bail, Result};
use serde_json::{json, Value};

use crate::state::model::*;

impl AppState {
    pub(super) async fn list_map(&self, name: &str) -> Result<Value> {
        let m = self.inner.lock().await;
        let vals: Vec<Value> = match name {
            "bindings" => m.bindings.values(),
            "routes" => m.routes.values(),
            _ => unreachable!(),
        }
        .cloned()
        .collect();
        Ok(json!({"count":vals.len(),"items":vals}))
    }
    pub(super) async fn upsert_binding(&self, a: Value, create: bool) -> Result<Value> {
        let id = str_arg(&a, "sessionBindingID")?;
        let item = json!({"sessionBindingID":id,"enabled":a["enabled"].as_bool().unwrap_or(true),"runtimeID":s(&a,"runtimeID"),"sessionID": if create && s(&a,"sessionID").is_empty(){format!("session_{}",now_ms())}else{s(&a,"sessionID")},"directory":s(&a,"directory"),"displayID":s(&a,"displayID"),"title":s(&a,"title"),"model":s(&a,"model"),"executor":executor_audit(&a)});
        self.inner
            .lock()
            .await
            .bindings
            .insert(id.into(), item.clone());
        Ok(item)
    }
    pub(super) async fn delete_binding(&self, a: Value) -> Result<Value> {
        let id = str_arg(&a, "sessionBindingID")?;
        let mut m = self.inner.lock().await;
        if m.routes
            .values()
            .any(|r| r["sessionBindingID"].as_str() == Some(id))
        {
            bail!("sessionBinding still used by routes: {id}");
        }
        m.bindings.remove(id);
        Ok(json!({"ok":true,"sessionBindingID":id}))
    }
    pub(super) async fn upsert_route(&self, a: Value) -> Result<Value> {
        let provider = str_arg(&a, "provider")?.to_lowercase();
        let account = str_arg(&a, "accountID")?;
        let chat = str_arg(&a, "chatID")?;
        self.require_account(&provider, account).await?;
        let id = route_id(&provider, account, chat);
        let item = json!({"routeID":id,"provider":provider,"accountID":account,"chatID":chat,"chatName":s(&a,"chatName"),"enabled":a["enabled"].as_bool().unwrap_or(true),"sessionBindingID":s(&a,"sessionBindingID"),"executor":executor_audit(&a)});
        self.inner.lock().await.routes.insert(id, item.clone());
        Ok(item)
    }
    pub(super) async fn get_route(&self, a: Value) -> Result<Value> {
        let id = str_arg(&a, "routeID")?;
        self.inner
            .lock()
            .await
            .routes
            .get(id)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("route not found: {id}"))
    }
    pub(super) async fn delete_route(&self, a: Value) -> Result<Value> {
        let id = str_arg(&a, "routeID")?;
        self.inner.lock().await.routes.remove(id);
        Ok(json!({"ok":true,"routeID":id}))
    }
    pub(super) async fn route(&self, route_id: &str) -> Result<Value> {
        self.inner
            .lock()
            .await
            .routes
            .get(route_id)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("route not found: {route_id}"))
    }
}
