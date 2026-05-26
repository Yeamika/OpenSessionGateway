use crate::{
    api,
    config::ConfigStore,
    gv_client::GvClient,
    session_tools::{session_tool_names, SessionToolServices},
    state::SharedState,
};
use anyhow::{bail, Result};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
pub struct RpcRequest {
    #[serde(default)]
    pub id: Value,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

pub async fn handle(
    state: &SharedState,
    gv: &GvClient,
    session_tools: &SessionToolServices,
    config: &ConfigStore,
    body: &[u8],
) -> Value {
    match handle_result(state, gv, session_tools, config, body).await {
        Ok((id, result)) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err(error) => json!({
            "jsonrpc": "2.0",
            "id": null,
            "error": { "code": -32000, "message": error.to_string() }
        }),
    }
}

async fn handle_result(
    state: &SharedState,
    gv: &GvClient,
    session_tools: &SessionToolServices,
    config: &ConfigStore,
    body: &[u8],
) -> Result<(Value, Value)> {
    let request: RpcRequest = serde_json::from_slice(body)?;
    let result = match request.method.as_str() {
        "initialize" => {
            json!({ "name": "session-control-endpoint", "version": env!("CARGO_PKG_VERSION") })
        }
        "tools/list" => list_tools(),
        "tools/call" => call_tool(state, gv, session_tools, config, request.params).await?,
        other => bail!("unknown MCP method '{other}'"),
    };
    Ok((request.id, result))
}

async fn call_tool(
    state: &SharedState,
    gv: &GvClient,
    session_tools: &SessionToolServices,
    config: &ConfigStore,
    params: Value,
) -> Result<Value> {
    let name = params.get("name").and_then(Value::as_str).unwrap_or("");
    let args = params
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let bytes = serde_json::to_vec(&args)?;
    match name {
        "state" => Ok(serde_json::to_value(state.snapshot().await)?),
        "connect" => api::connect(gv, &bytes).await,
        "disconnect" => api::disconnect(gv).await,
        "request" => api::request(gv, &bytes).await,
        "control" => api::control(gv, &bytes).await,
        "ReloadConfig" => config.reload(state).await,
        tool_name => session_tools
            .call(tool_name, args, state)
            .await?
            .ok_or_else(|| anyhow::anyhow!("unknown tool '{tool_name}'")),
    }
}

fn list_tools() -> Value {
    let mut tools = vec![
        json!({ "name": "state", "inputSchema": empty_schema() }),
        json!({ "name": "connect", "inputSchema": connect_schema() }),
        json!({ "name": "disconnect", "inputSchema": empty_schema() }),
        json!({ "name": "request", "inputSchema": send_schema(&["runtime_session_view_snapshot", "runtime_session_messages"]) }),
        json!({ "name": "control", "inputSchema": send_schema(&["add_prompt", "abort_session", "compact_session", "create_session", "rename_session", "resume_session"]) }),
        json!({ "name": "ReloadConfig", "inputSchema": empty_schema() }),
    ];
    tools.extend(session_tool_names().iter().map(|name| {
        json!({ "name": name, "inputSchema": crate::session_tools::session_tool_schema(name) })
    }));
    json!({ "tools": tools })
}

fn empty_schema() -> Value {
    json!({ "type": "object", "properties": {}, "additionalProperties": false })
}

fn connect_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "router_url": { "type": "string", "pattern": "\\S" },
            "node_id": { "type": "string", "pattern": "\\S" },
            "source": { "type": "object" },
            "target": { "type": "object" }
        },
        "required": ["router_url", "node_id", "source", "target"],
        "additionalProperties": true
    })
}

fn send_schema(subtypes: &[&str]) -> Value {
    json!({
        "type": "object",
        "properties": {
            "subtype": { "type": "string", "enum": subtypes },
            "payload": { "type": "object" }
        },
        "required": ["subtype"],
        "additionalProperties": true
    })
}
