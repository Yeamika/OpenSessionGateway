use anyhow::Result;
use serde_json::{json, Value};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};

use crate::state::AppState;

pub async fn serve(addr: String, state: AppState) -> Result<()> {
    let listener = TcpListener::bind(&addr).await?;
    tracing::info!(%addr, "IM endpoint HTTP/web server listening");
    loop {
        let (stream, _) = listener.accept().await?;
        let state = state.clone();
        tokio::spawn(async move {
            let _ = handle(stream, state).await;
        });
    }
}

async fn handle(mut stream: TcpStream, state: AppState) -> Result<()> {
    let mut buf = vec![0; 1024 * 1024];
    let n = stream.read(&mut buf).await?;
    if n == 0 {
        return Ok(());
    }
    let req = String::from_utf8_lossy(&buf[..n]);
    let (head, body) = req.split_once("\r\n\r\n").unwrap_or((&req, ""));
    let mut first = head.lines().next().unwrap_or("").split_whitespace();
    let method = first.next().unwrap_or("");
    let path = first.next().unwrap_or("/");
    let (status, ctype, payload) = route(method, path, body.as_bytes(), state).await;
    write_response(&mut stream, status, ctype, &payload).await
}

async fn route(
    method: &str,
    path: &str,
    body: &[u8],
    state: AppState,
) -> (u16, &'static str, Vec<u8>) {
    if method == "POST" && path == "/api/config/reload" {
        return match state.reload_config().await {
            Ok(v) => json_body(200, v),
            Err(e) => json_body(400, json!({"ok":false,"error":e.to_string()})),
        };
    }
    if method == "POST" && path.starts_with("/imgw/uploads/") {
        let id = path.trim_start_matches("/imgw/uploads/");
        return match state
            .write_upload(id, "upload.bin", "application/octet-stream", body)
            .await
        {
            Ok(v) => json_body(200, json!({"ok":true,"data":v})),
            Err(e) => json_body(404, json!({"ok":false,"error":e.to_string()})),
        };
    }
    if method == "GET" && path.starts_with("/imgw/assets/") {
        let id = path.trim_start_matches("/imgw/assets/");
        return match state.read_asset(id).await {
            Ok((ctype, bytes)) => (200, Box::leak(ctype.into_boxed_str()), bytes),
            Err(e) => json_body(404, json!({"ok":false,"error":e.to_string()})),
        };
    }
    if method == "GET" {
        if path == "/" {
            return asset("text/html", include_bytes!("../web/index.html"));
        }
        if path == "/styles.css" {
            return asset("text/css", include_bytes!("../web/styles.css"));
        }
        if let Some(bytes) = js_asset(path) {
            return asset("application/javascript", bytes);
        }
        if path == "/health" {
            return json_body(200, json!({"ok":true,"name":"im-endpoint"}));
        }
    }
    if method == "POST"
        && (path == "/api/v2/mcp/im_gateway_control" || path == "/api/v2/mcp/im_gateway_chat")
    {
        let channel = if path.ends_with("chat") {
            "chat"
        } else {
            "control"
        };
        return match handle_rpc(channel, body, state).await {
            Ok(v) => json_body(200, v),
            Err(e) => json_body(400, json!({"error":{"message":e.to_string()}})),
        };
    }
    json_body(404, json!({"ok":false,"error":"not_found"}))
}

pub(crate) async fn handle_rpc(channel: &str, body: &[u8], state: AppState) -> Result<Value> {
    let req: Value = serde_json::from_slice(body)?;
    let id = req.get("id").cloned().unwrap_or(Value::Null);
    match req["method"].as_str().unwrap_or("") {
        "initialize" => Ok(
            json!({"jsonrpc":"2.0","id":id,"result":{"protocolVersion":"2025-03-26","serverInfo":{"name":"im-endpoint","version":"0.1.0"},"capabilities":{"tools":{"listChanged":false}}}}),
        ),
        "tools/list" => Ok(json!({"jsonrpc":"2.0","id":id,"result":{"tools":tool_names(channel)}})),
        "tools/call" => {
            let params = &req["params"];
            let tool = params["name"].as_str().unwrap_or("");
            let args = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            let result = state.call_tool(channel, tool, args).await?;
            Ok(
                json!({"jsonrpc":"2.0","id":id,"result":{"content":[{"type":"text","text":serde_json::to_string(&result)?}]}}),
            )
        }
        other => Ok(
            json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":format!("method not found: {other}")}}),
        ),
    }
}

fn tool_names(channel: &str) -> Vec<Value> {
    let names = if channel == "chat" {
        vec![
            "GetTransferEndpoint",
            "ListRouteMessages",
            "SendRouteTextMessage",
            "RequestUpload",
            "SendRouteUpload",
            "RequestDownload",
            "ListRecentRouteEvents",
        ]
    } else {
        vec![
            "GetGatewayInfo",
            "ReloadConfig",
            "ListProviders",
            "ListAccounts",
            "UpsertAccount",
            "DeleteAccount",
            "ListAccountChats",
            "CreateAccountChat",
            "DeleteAccountChat",
            "ListAccountChatMembers",
            "AddAccountChatMembers",
            "ListSessionBindings",
            "UpsertSessionBinding",
            "CreateSessionBinding",
            "DeleteSessionBinding",
            "ListRoutes",
            "GetRoute",
            "UpsertRoute",
            "DeleteRoute",
        ]
    };
    names.into_iter().map(tool_schema).collect()
}

fn tool_schema(name: &str) -> Value {
    let mut required = vec![];
    if requires_executor(name) {
        required.push("ExecutorSessionID");
    }
    json!({
        "name": name,
        "inputSchema": {
            "type": "object",
            "properties": {
                "ExecutorSessionID": {"type":"string", "pattern":"\\S", "description":"Executor/caller sessionID used for audit ownership; distinct from target sessionID/sessionBindingID"},
                "ExecutorRuntimeID": {"type":"string", "description":"Optional executor/caller runtimeID for audit ownership"}
            },
            "required": required,
            "additionalProperties": true
        }
    })
}

fn requires_executor(name: &str) -> bool {
    matches!(
        name,
        "ReloadConfig"
            | "UpsertAccount"
            | "DeleteAccount"
            | "CreateAccountChat"
            | "DeleteAccountChat"
            | "AddAccountChatMembers"
            | "UpsertSessionBinding"
            | "CreateSessionBinding"
            | "DeleteSessionBinding"
            | "UpsertRoute"
            | "DeleteRoute"
            | "ListRouteMessages"
            | "SendRouteTextMessage"
            | "RequestUpload"
            | "SendRouteUpload"
            | "RequestDownload"
            | "ListRecentRouteEvents"
    )
}

fn js_asset(path: &str) -> Option<&'static [u8]> {
    Some(match path {
        "/src/app.js" => include_bytes!("../web/src/app.js"),
        "/src/config.js" => include_bytes!("../web/src/config.js"),
        "/src/state.js" => include_bytes!("../web/src/state.js"),
        "/src/osgp-wire.js" => include_bytes!("../web/src/osgp-wire.js"),
        "/src/transport.js" => include_bytes!("../web/src/transport.js"),
        "/src/im-tools.js" => include_bytes!("../web/src/im-tools.js"),
        "/src/ui.js" => include_bytes!("../web/src/ui.js"),
        _ => return None,
    })
}

fn asset(ctype: &'static str, bytes: &'static [u8]) -> (u16, &'static str, Vec<u8>) {
    (200, ctype, bytes.to_vec())
}
fn json_body(status: u16, value: Value) -> (u16, &'static str, Vec<u8>) {
    (
        status,
        "application/json",
        serde_json::to_vec(&value).unwrap_or_default(),
    )
}
async fn write_response(
    stream: &mut TcpStream,
    status: u16,
    ctype: &str,
    body: &[u8],
) -> Result<()> {
    let reason = if status == 200 {
        "OK"
    } else if status == 404 {
        "Not Found"
    } else {
        "Bad Request"
    };
    let head = format!("HTTP/1.1 {status} {reason}\r\ncontent-type: {ctype}\r\ncontent-length: {}\r\naccess-control-allow-origin: *\r\nconnection: close\r\n\r\n", body.len());
    stream.write_all(head.as_bytes()).await?;
    stream.write_all(body).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gv::GvClient;

    #[tokio::test]
    async fn tools_list_returns_control_and_chat_tools() {
        let state = AppState::new(GvClient::test());
        let body = br#"{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}"#;
        let control = handle_rpc("control", body, state.clone()).await.unwrap();
        let chat = handle_rpc("chat", body, state).await.unwrap();
        assert!(control["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .any(|t| t["name"] == "UpsertAccount"));
        assert!(chat["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .any(|t| t["name"] == "SendRouteTextMessage"));
    }
}
