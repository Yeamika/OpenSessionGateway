use anyhow::{bail, Result};
use serde_json::{json, Value};

use crate::{provider, state::model::*};

impl AppState {
    pub(super) async fn gateway_info(&self) -> Result<Value> {
        let m = self.inner.lock().await;
        Ok(
            json!({"ok":true,"name":"im-endpoint","gv":self.gv.status().await,"providerCount":2,"accountCount":m.accounts.len(),"sessionBindingCount":m.bindings.len(),"routeCount":m.routes.len(),"uploadCount":m.uploads.len(),"assetCount":m.assets.len()}),
        )
    }

    pub(super) async fn list_accounts(&self) -> Result<Value> {
        let vals: Vec<Value> = self.inner.lock().await.accounts.values().cloned().collect();
        Ok(json!({"count":vals.len(),"items":vals}))
    }

    pub(super) async fn upsert_account(&self, a: Value) -> Result<Value> {
        let provider = str_arg(&a, "provider")?.to_lowercase();
        let account = str_arg(&a, "accountID")?;
        let config = provider::normalize_account_config(
            &provider,
            a.get("config").cloned().unwrap_or_else(|| json!({})),
        )?;
        let item = json!({"provider":provider,"accountID":account,"displayName":a["displayName"].as_str().unwrap_or(account),"enabled":a["enabled"].as_bool().unwrap_or(true),"config":config,"runtimeInfo":{"started":a["enabled"].as_bool().unwrap_or(true)},"executor":executor_audit(&a)});
        provider::ensure_feishu_mockable(&item)?;
        let mut m = self.inner.lock().await;
        m.accounts
            .insert(account_key(&provider, account), item.clone());
        ensure_default_chat(&mut m, &provider, account, &item["config"]);
        Ok(item)
    }

    pub(super) async fn delete_account(&self, a: Value) -> Result<Value> {
        let provider = str_arg(&a, "provider")?.to_lowercase();
        let account = str_arg(&a, "accountID")?;
        let key = account_key(&provider, account);
        let mut m = self.inner.lock().await;
        m.accounts.remove(&key);
        m.chats.retain(|k, _| !k.starts_with(&format!("{key}::")));
        m.members.retain(|k, _| !k.starts_with(&format!("{key}::")));
        Ok(json!({"ok":true,"provider":provider,"accountID":account}))
    }

    pub(super) async fn require_account(&self, provider: &str, account: &str) -> Result<()> {
        if self
            .inner
            .lock()
            .await
            .accounts
            .contains_key(&account_key(provider, account))
        {
            Ok(())
        } else {
            bail!("account not found: {provider}/{account}")
        }
    }
}

fn ensure_default_chat(m: &mut Model, provider: &str, account: &str, cfg: &Value) {
    let id = cfg["defaultChatID"].as_str().unwrap_or("local-chat");
    let name = cfg["defaultChatName"].as_str().unwrap_or(id);
    let k = chat_key(provider, account, id);
    m.chats
        .entry(k.clone())
        .or_insert_with(|| chat_value(provider, account, id, name, String::new()));
    m.members.entry(k).or_insert_with(|| vec![json!({"memberIDType":"app_id","memberID":cfg["botID"].as_str().unwrap_or("local-bot"),"name":cfg["botName"].as_str().unwrap_or("Local Bot"),"tenantKey":"local"})]);
}

impl AppState {
    pub async fn set_config_path(&self, path: Option<std::path::PathBuf>) {
        self.inner.lock().await.config_path = path;
    }

    pub async fn reload_config(&self) -> Result<Value> {
        let path = self.inner.lock().await.config_path.clone();
        let cfg = crate::im_config::load_config(path.as_deref())?;
        let mut added_or_updated = 0usize;
        let mut disabled_or_removed = 0usize;
        let mut m = self.inner.lock().await;
        let mut seen = std::collections::BTreeSet::new();
        for account in &cfg.accounts {
            let provider = account.provider.to_lowercase();
            let key = account_key(&provider, &account.account_id);
            seen.insert(key.clone());
            if account.enabled {
                let item = crate::im_config::mask_account(account);
                m.accounts.insert(key, item.clone());
                ensure_default_chat(&mut m, &provider, &account.account_id, &item["config"]);
                added_or_updated += 1;
            } else if m.accounts.remove(&key).is_some() {
                disabled_or_removed += 1;
            }
        }
        let keys: Vec<String> = m.accounts.keys().cloned().collect();
        for key in keys {
            if !seen.contains(&key) && key.starts_with("feishu::") {
                m.accounts.remove(&key);
                disabled_or_removed += 1;
            }
        }
        m.loaded_config = cfg;
        Ok(
            json!({"ok":true,"configPath":path.map(|p|p.display().to_string()),"activeAccounts":m.accounts.len(),"addedOrUpdated":added_or_updated,"disabledOrRemoved":disabled_or_removed}),
        )
    }

    pub async fn loaded_config(&self) -> crate::im_config::ImConfig {
        self.inner.lock().await.loaded_config.clone()
    }
}
