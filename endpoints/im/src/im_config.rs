use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImConfig {
    #[serde(default)]
    pub router_url: String,
    #[serde(default)]
    pub accounts: Vec<ConfigAccount>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigAccount {
    pub provider: String,
    #[serde(alias = "accountID")]
    pub account_id: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub credentials: Value,
    #[serde(default)]
    pub config: Value,
    #[serde(default)]
    pub test: AccountTestConfig,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountTestConfig {
    #[serde(default, alias = "chatID")]
    pub chat_id: String,
    #[serde(default)]
    pub allow_send_smoke: bool,
}

pub fn load_config(path: Option<&Path>) -> Result<ImConfig> {
    let Some(path) = path else {
        return Ok(ImConfig::default());
    };
    if !path.exists() {
        return Ok(ImConfig::default());
    }
    let text =
        fs::read_to_string(path).with_context(|| format!("read IM config {}", path.display()))?;
    serde_json::from_str(&text).with_context(|| format!("parse IM config {}", path.display()))
}

pub fn mask_account(account: &ConfigAccount) -> Value {
    let mut config = account.config.clone();
    if account.provider.eq_ignore_ascii_case("feishu")
        || account.provider.eq_ignore_ascii_case("lark")
    {
        config["credentialStatus"] = credential_status_json(&account.credentials, &account.test);
    }
    json!({
        "provider": account.provider,
        "accountID": account.account_id,
        "displayName": account.display_name,
        "enabled": account.enabled,
        "config": config
    })
}

pub fn credential_status_json(credentials: &Value, test: &AccountTestConfig) -> Value {
    json!({
        "hasAppID": has(credentials, "appId"),
        "hasAppSecret": has(credentials, "appSecret"),
        "hasVerificationToken": has(credentials, "verificationToken"),
        "hasEncryptKey": has(credentials, "encryptKey"),
        "hasTestChat": !test.chat_id.trim().is_empty(),
        "allowSendSmoke": test.allow_send_smoke
    })
}

pub fn find_account<'a>(cfg: &'a ImConfig, account_id: &str) -> Option<&'a ConfigAccount> {
    cfg.accounts.iter().find(|a| a.account_id == account_id)
}

pub fn default_config_path() -> PathBuf {
    PathBuf::from("endpoints/im/config.local.json")
}
fn has(v: &Value, key: &str) -> bool {
    v[key].as_str().is_some_and(|s| !s.trim().is_empty())
}
fn default_true() -> bool {
    true
}
