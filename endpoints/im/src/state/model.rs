use std::{collections::BTreeMap, path::PathBuf, sync::Arc};

use serde_json::{json, Value};
use tokio::sync::Mutex;

use crate::gv::GvClient;

#[derive(Clone)]
pub struct AppState {
    pub(super) inner: Arc<Mutex<Model>>,
    pub(super) gv: GvClient,
}

#[derive(Default)]
pub(super) struct Model {
    pub accounts: BTreeMap<String, Value>,
    pub chats: BTreeMap<String, Value>,
    pub members: BTreeMap<String, Vec<Value>>,
    pub bindings: BTreeMap<String, Value>,
    pub routes: BTreeMap<String, Value>,
    pub messages: BTreeMap<String, Vec<Value>>,
    pub uploads: BTreeMap<String, Value>,
    pub assets: BTreeMap<String, Value>,
    pub events: BTreeMap<String, Vec<Value>>,
    pub config_path: Option<PathBuf>,
    pub loaded_config: crate::im_config::ImConfig,
}

impl AppState {
    pub fn new(gv: GvClient) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Model::default())),
            gv,
        }
    }

    #[cfg(test)]
    pub async fn recorded_gv(&self) -> Vec<osgp::SessionEnvelope> {
        self.gv.recorded().await
    }
}

pub(super) fn account_key(p: &str, a: &str) -> String {
    format!("{p}::{a}")
}
pub(super) fn chat_key(p: &str, a: &str, c: &str) -> String {
    format!("{}::{}::{}", p, a, c)
}
pub(super) fn route_id(p: &str, a: &str, c: &str) -> String {
    format!("{}::{}::{}", p, a, c)
}

pub(super) fn chat_value(
    provider: &str,
    account: &str,
    chat: &str,
    name: &str,
    desc: String,
) -> Value {
    json!({"chatID":chat,"provider":provider,"accountID":account,"name":name,"description":desc,"avatar":"","chatStatus":"active","chatType":"group","chatMode":"group","ownerID":"","ownerIDType":"user_id","tenantKey":provider,"external":false,"userCount":0,"botCount":1,"lastMessageTime":null,"lastMessageType":null,"lastMessagePreview":"","detailError":""})
}

pub(super) fn message(
    route: &Value,
    typ: &str,
    content: &str,
    res_type: &str,
    res_key: &str,
) -> Value {
    json!({"messageID":format!("msg_{}",now_ms()),"routeID":route["routeID"],"provider":route["provider"],"accountID":route["accountID"],"chatID":route["chatID"],"msgType":typ,"resourceType":res_type,"resourceKey":res_key,"senderID":"im-endpoint","senderType":"bot","preview":content,"content":content,"createTime":now_ms().to_string()})
}

pub(super) fn strings(v: Option<&Value>) -> Vec<&str> {
    v.and_then(|x| x.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default()
}

pub(super) fn ids_to_members(v: Option<&Value>, typ: &str) -> Vec<Value> {
    strings(v)
        .into_iter()
        .map(|id| json!({"memberIDType":typ,"memberID":id,"name":id,"tenantKey":"local"}))
        .collect()
}

pub(super) fn str_arg<'a>(v: &'a Value, key: &str) -> anyhow::Result<&'a str> {
    v[key]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| anyhow::anyhow!("{key} is required"))
}
pub(super) fn s(v: &Value, key: &str) -> String {
    v[key].as_str().unwrap_or_default().to_string()
}
pub(super) fn s_or(v: &Value, key: &str, fallback: &str) -> String {
    v[key].as_str().unwrap_or(fallback).to_string()
}
pub(super) fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

pub(super) fn executor_audit(v: &Value) -> Value {
    json!({"ExecutorSessionID": s(v, "ExecutorSessionID"), "ExecutorRuntimeID": s(v, "ExecutorRuntimeID")})
}
