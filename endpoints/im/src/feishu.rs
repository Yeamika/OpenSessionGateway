use anyhow::{bail, Result};
use serde_json::{json, Value};

use crate::im_config::{ConfigAccount, ImConfig};

pub fn credential_status_json(account: &ConfigAccount) -> Value {
    crate::im_config::credential_status_json(&account.credentials, &account.test)
}

pub fn configured_variable_names() -> Vec<&'static str> {
    vec![
        "appId",
        "appSecret",
        "verificationToken",
        "encryptKey",
        "test.chatID",
        "test.allowSendSmoke",
    ]
}

pub async fn verify_tenant_token(account: &ConfigAccount) -> Result<Value> {
    let app_id = secret(&account.credentials, "appId").ok_or_else(|| {
        anyhow::anyhow!(
            "Feishu appId missing in config account {}",
            account.account_id
        )
    })?;
    let app_secret = secret(&account.credentials, "appSecret").ok_or_else(|| {
        anyhow::anyhow!(
            "Feishu appSecret missing in config account {}",
            account.account_id
        )
    })?;
    let token = request_tenant_token(&app_id, &app_secret).await?;
    Ok(
        json!({"ok":true,"accountID":account.account_id,"tenantTokenReceived":!token.is_empty(),"credentialStatus":credential_status_json(account)}),
    )
}

pub async fn smoke_from_config(
    cfg: &ImConfig,
    account_id: Option<&str>,
    send: bool,
) -> Result<Value> {
    let account = account_id
        .and_then(|id| crate::im_config::find_account(cfg, id))
        .or_else(|| {
            cfg.accounts.iter().find(|a| {
                a.provider.eq_ignore_ascii_case("feishu") || a.provider.eq_ignore_ascii_case("lark")
            })
        });
    let Some(account) = account else {
        return Ok(
            json!({"ok":true,"realSmoke":"SKIPPED_NO_FEISHU_ACCOUNT","configuredNames":configured_variable_names()}),
        );
    };
    let verified = verify_tenant_token(account).await?;
    if !send {
        return Ok(json!({"ok":true,"realSmoke":"TOKEN_VERIFIED_SEND_SKIPPED","verify":verified}));
    }
    if !account.test.allow_send_smoke || account.test.chat_id.trim().is_empty() {
        return Ok(
            json!({"ok":true,"realSmoke":"BLOCKED_FOR_REAL_MUTATION","verify":verified,"reason":"test.chatID and test.allowSendSmoke=true are required"}),
        );
    }
    let sent = send_test_message(account, "gv-im-smoke").await?;
    Ok(json!({"ok":true,"realSmoke":"MESSAGE_SENT","verify":verified,"send":sent}))
}

async fn send_test_message(account: &ConfigAccount, prefix: &str) -> Result<Value> {
    let app_id = secret(&account.credentials, "appId")
        .ok_or_else(|| anyhow::anyhow!("Feishu appId missing"))?;
    let app_secret = secret(&account.credentials, "appSecret")
        .ok_or_else(|| anyhow::anyhow!("Feishu appSecret missing"))?;
    let token = request_tenant_token(&app_id, &app_secret).await?;
    let text = format!("{} {}", prefix, timestamp());
    let body = json!({"receive_id":account.test.chat_id,"msg_type":"text","content":json!({"text":text}).to_string()});
    let resp = reqwest::Client::new()
        .post("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id")
        .bearer_auth(token)
        .json(&body)
        .send()
        .await?;
    let status = resp.status();
    let value: Value = resp.json().await.unwrap_or_else(|_| json!({}));
    if !status.is_success() || value["code"].as_i64().unwrap_or(0) != 0 {
        bail!(
            "Feishu test message failed with status {status} code {}",
            value["code"].as_i64().unwrap_or(-1)
        );
    }
    Ok(
        json!({"sent":true,"prefix":prefix,"messageIDSet":value["data"]["message_id"].as_str().is_some()}),
    )
}

async fn request_tenant_token(app_id: &str, app_secret: &str) -> Result<String> {
    let resp = reqwest::Client::new()
        .post("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal")
        .json(&json!({"app_id":app_id,"app_secret":app_secret}))
        .send()
        .await?;
    let status = resp.status();
    let value: Value = resp.json().await.unwrap_or_else(|_| json!({}));
    if !status.is_success() || value["code"].as_i64().unwrap_or(0) != 0 {
        bail!(
            "Feishu tenant token request failed with status {status} code {}",
            value["code"].as_i64().unwrap_or(-1)
        );
    }
    value["tenant_access_token"]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| anyhow::anyhow!("Feishu tenant token missing in response"))
}

fn secret(v: &Value, key: &str) -> Option<String> {
    v[key]
        .as_str()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}
fn timestamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
}
