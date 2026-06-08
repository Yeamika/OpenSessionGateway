use crate::{
    config::ConfigStore,
    state::SharedState,
    tools::{mailbox_tool_names, MailboxToolServices},
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
    tools: &MailboxToolServices,
    config: &ConfigStore,
    body: &[u8],
) -> Value {
    match handle_result(state, tools, config, body).await {
        Ok((id, result)) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err(error) => {
            json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32000, "message": error.to_string() } })
        }
    }
}

async fn handle_result(
    state: &SharedState,
    tools: &MailboxToolServices,
    config: &ConfigStore,
    body: &[u8],
) -> Result<(Value, Value)> {
    let request: RpcRequest = serde_json::from_slice(body)?;
    let result = match request.method.as_str() {
        "initialize" => json!({
            "protocolVersion": "2025-03-26",
            "serverInfo": {
                "name": "mailbox-endpoint",
                "version": env!("CARGO_PKG_VERSION")
            },
            "capabilities": { "tools": { "listChanged": false } }
        }),
        "tools/list" => list_tools(),
        "tools/call" => mcp_text_result(call_tool(state, tools, config, request.params).await?),
        other => bail!("unknown MCP method '{other}'"),
    };
    Ok((request.id, result))
}

async fn call_tool(
    state: &SharedState,
    tools: &MailboxToolServices,
    config: &ConfigStore,
    params: Value,
) -> Result<Value> {
    let name = params.get("name").and_then(Value::as_str).unwrap_or("");
    let args = params
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));
    match name {
        "status" => Ok(serde_json::to_value(state.snapshot().await)?),
        "ReloadConfig" => config.reload(state).await,
        tool_name => tools
            .call(tool_name, args)
            .await?
            .ok_or_else(|| anyhow::anyhow!("unknown tool '{tool_name}'")),
    }
}

fn list_tools() -> Value {
    let mut tools = vec![
        json!({ "name": "status", "inputSchema": empty_schema() }),
        json!({ "name": "ReloadConfig", "inputSchema": empty_schema() }),
    ];
    tools.extend(mailbox_tool_names().iter().map(
        |name| json!({ "name": name, "inputSchema": crate::tools::mailbox_tool_schema(name) }),
    ));
    json!({ "tools": tools })
}

fn empty_schema() -> Value {
    json!({ "type": "object", "properties": {}, "additionalProperties": false })
}

fn mcp_text_result(data: Value) -> Value {
    json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string_pretty(&data).unwrap_or_default()
        }]
    })
}
