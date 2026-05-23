use anyhow::{bail, Result};
use serde_json::{json, Value};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProviderKind {
    Local,
    Feishu,
}

pub fn list_providers() -> Vec<Value> {
    vec![
        json!({"id":"local","displayName":"Local diagnostic provider"}),
        json!({"id":"feishu","displayName":"Feishu/Lark config-driven adapter"}),
    ]
}

pub fn provider_kind(provider: &str) -> Result<ProviderKind> {
    match provider.trim().to_lowercase().as_str() {
        "local" => Ok(ProviderKind::Local),
        "feishu" | "lark" => Ok(ProviderKind::Feishu),
        other => bail!("unsupported IM provider: {other}"),
    }
}

pub fn normalize_account_config(provider: &str, config: Value) -> Result<Value> {
    match provider_kind(provider)? {
        ProviderKind::Local => Ok(json!({
            "botID": config["botID"].as_str().unwrap_or("local-bot"),
            "botName": config["botName"].as_str().unwrap_or("Local Bot"),
            "defaultChatID": config["defaultChatID"].as_str().unwrap_or("local-chat"),
            "defaultChatName": config["defaultChatName"].as_str().unwrap_or("Local Chat")
        })),
        ProviderKind::Feishu => Ok(json!({
            "mock": config["mock"].as_bool().unwrap_or(true),
            "note": "real Feishu/Lark credentials are loaded from endpoint config file and masked in state"
        })),
    }
}

pub fn ensure_feishu_mockable(account: &Value) -> Result<()> {
    if account["provider"].as_str() != Some("feishu")
        && account["provider"].as_str() != Some("lark")
    {
        return Ok(());
    }
    if account["config"]["mock"].as_bool().unwrap_or(true) {
        return Ok(());
    }
    bail!("real Feishu/Lark adapter requires config-file credentials; use config.mock=true for ad-hoc tests")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn feishu_config_masks_credentials() {
        let cfg = normalize_account_config("feishu", json!({"mock":true})).unwrap();
        assert!(cfg.get("appSecret").is_none());
        assert_eq!(cfg["mock"], true);
    }
}
