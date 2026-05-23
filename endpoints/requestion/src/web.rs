//! Minimal HTTP server for requestion web UI and MCP-style JSON API.

use std::sync::Arc;

use anyhow::Result;
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, RwLock};

use crate::cache::{RequestionCache, SessionStateCache};
use crate::cli::{format_address, reload_from_config_path, CliConfig};
use crate::gv_client::{build_requestion_respond, OutboundControl, QueuedResponse, RespondRequest};

const INDEX_HTML: &str = include_str!("../web/index.html");
const APP_JS: &str = include_str!("../web/app.js");
const STYLES_CSS: &str = include_str!("../web/styles.css");

pub async fn run_web_server(
    config: Arc<RwLock<CliConfig>>,
    session_cache: Arc<RwLock<SessionStateCache>>,
    requestion_cache: Arc<RwLock<RequestionCache>>,
    outbound_tx: mpsc::Sender<OutboundControl>,
) -> Result<()> {
    let listen_addr = config.read().await.web_addr.clone();
    let listener = TcpListener::bind(&listen_addr).await?;
    println!(
        "[requestion-endpoint] web/MCP API listening on http://{}",
        listen_addr
    );
    loop {
        let (stream, _) = listener.accept().await?;
        let ctx = WebContext {
            config: config.clone(),
            session_cache: session_cache.clone(),
            requestion_cache: requestion_cache.clone(),
            outbound_tx: outbound_tx.clone(),
        };
        tokio::spawn(async move {
            if let Err(error) = handle_connection(stream, ctx).await {
                eprintln!("[requestion-endpoint] web request error: {error}");
            }
        });
    }
}

#[derive(Clone)]
struct WebContext {
    config: Arc<RwLock<CliConfig>>,
    session_cache: Arc<RwLock<SessionStateCache>>,
    requestion_cache: Arc<RwLock<RequestionCache>>,
    outbound_tx: mpsc::Sender<OutboundControl>,
}

async fn handle_connection(mut stream: TcpStream, ctx: WebContext) -> Result<()> {
    let mut buf = vec![0; 64 * 1024];
    let n = stream.read(&mut buf).await?;
    if n == 0 {
        return Ok(());
    }
    let raw = String::from_utf8_lossy(&buf[..n]);
    let request = parse_request(&raw);
    let response = route_request(request, ctx).await;
    stream.write_all(&response.as_bytes()).await?;
    Ok(())
}

async fn route_request(request: HttpRequest, ctx: WebContext) -> HttpResponse {
    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/") | ("GET", "/index.html") => HttpResponse::ok("text/html", INDEX_HTML),
        ("GET", "/app.js") => HttpResponse::ok("text/javascript", APP_JS),
        ("GET", "/styles.css") => HttpResponse::ok("text/css", STYLES_CSS),
        ("GET", "/api/requestions") => requestions_json(&ctx).await,
        ("GET", "/api/config") => config_json(&ctx).await,
        ("POST", "/api/config/reload") => reload_config_json(&ctx).await,
        ("POST", "/api/respond") => respond_json(&ctx, &request.body).await,
        ("POST", "/mcp") => mcp_json(&ctx, &request.body).await,
        _ => HttpResponse::not_found(),
    }
}

async fn config_json(ctx: &WebContext) -> HttpResponse {
    let config = ctx.config.read().await.clone();
    HttpResponse::json(config_view(&config))
}

async fn reload_config_json(ctx: &WebContext) -> HttpResponse {
    let current = ctx.config.read().await.clone();
    match reload_from_config_path(&current) {
        Ok(next) => {
            *ctx.config.write().await = next.clone();
            HttpResponse::json(json!({ "ok": true, "config": config_view(&next) }))
        }
        Err(error) => HttpResponse::bad_request(&error.to_string()),
    }
}

fn config_view(config: &CliConfig) -> Value {
    json!({
        "nodeId": config.node_id,
        "routerUrl": config.router_url,
        "address": format_address(&config.address),
        "webAddr": config.web_addr,
        "noWeb": config.no_web,
        "seedDemo": config.seed_demo,
        "configPath": config.config_path.as_ref().map(|p| p.display().to_string()),
    })
}

async fn requestions_json(ctx: &WebContext) -> HttpResponse {
    let requestions = ctx
        .requestion_cache
        .read()
        .await
        .get_all()
        .into_iter()
        .cloned()
        .collect::<Vec<_>>();
    let grouped = ctx
        .requestion_cache
        .read()
        .await
        .grouped_by_session_for_web();
    let sessions = ctx.session_cache.read().await.len_for_web();
    HttpResponse::json(json!({
        "requestions": requestions,
        "groupedBySession": grouped,
        "sessionCount": sessions
    }))
}

async fn respond_json(ctx: &WebContext, body: &str) -> HttpResponse {
    match queue_response(ctx, body).await {
        Ok(value) => HttpResponse::json(json!(value)),
        Err(error) => HttpResponse::bad_request(&error),
    }
}

#[cfg(test)]
#[path = "web_tests.rs"]
mod web_tests;

async fn mcp_json(ctx: &WebContext, body: &str) -> HttpResponse {
    let input: Value = serde_json::from_str(body).unwrap_or_else(|_| json!({}));
    match input.get("method").and_then(Value::as_str).unwrap_or("") {
        "tools/list" => mcp_result(&input, json!({ "tools": tool_specs() })),
        "tools/call" => call_tool(ctx, &input).await,
        _ => mcp_error(&input, "unsupported MCP method"),
    }
}

async fn call_tool(ctx: &WebContext, input: &Value) -> HttpResponse {
    let params = input.get("params").unwrap_or(&Value::Null);
    match params.get("name").and_then(Value::as_str).unwrap_or("") {
        "list_requestions" => {
            let requestions = ctx
                .requestion_cache
                .read()
                .await
                .get_all()
                .into_iter()
                .cloned()
                .collect::<Vec<_>>();
            mcp_result(input, json!({ "requestions": requestions }))
        }
        "respond_requestion" => {
            let args = match executor_bound_args(input, params) {
                Ok(args) => args,
                Err(error) => return mcp_invalid(input, &error),
            };
            match queue_response(ctx, &args.to_string()).await {
                Ok(value) => mcp_result(
                    input,
                    json!({ "content": [{ "type": "text", "text": serde_json::to_string(&value).unwrap_or_default() }] }),
                ),
                Err(error) => mcp_invalid(input, &error),
            }
        }
        "ReloadConfig" => reload_config_mcp(ctx, input, params).await,
        _ => mcp_error(input, "unsupported MCP tool"),
    }
}

fn tool_specs() -> Value {
    json!([
        {
            "name": "list_requestions",
            "description": "List pending requestions",
            "inputSchema": {
                "type": "object",
                "properties": {},
                "required": [],
                "additionalProperties": false
            }
        },
        {
            "name": "respond_requestion",
            "description": "Approve, reject, or answer a requestion",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "ExecutorSessionID": {"type": "string", "pattern": "\\S", "description": "Executor/caller sessionID for approval attribution"},
                    "ExecutorRuntimeID": {"type": "string", "description": "Optional executor/caller runtimeID"},
                    "sessionID": {"type": "string", "pattern": "\\S", "description": "Target requestion sessionID"},
                    "requestID": {"type": "string", "pattern": "\\S", "description": "Target requestion/requestID"},
                    "decision": {"type": "string", "description": "approve, reject, or response"},
                    "response": {"type": "string", "description": "Optional approval note, rejection reason, or answer"},
                    "answers": {"type": "array", "description": "Optional explicit answer matrix"}
                },
                "required": ["ExecutorSessionID", "sessionID", "requestID", "decision"],
                "additionalProperties": true
            }
        },
        {
            "name": "ReloadConfig",
            "description": "Reload requestion endpoint config from configured file path",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "ExecutorSessionID": {"type": "string", "pattern": "\\S", "description": "Executor/caller sessionID for reload attribution"}
                },
                "required": ["ExecutorSessionID"],
                "additionalProperties": false
            }
        }
    ])
}

async fn reload_config_mcp(ctx: &WebContext, input: &Value, params: &Value) -> HttpResponse {
    let args = params
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));
    if require_non_empty(args.get("ExecutorSessionID"), "ExecutorSessionID").is_err() {
        return mcp_invalid(input, "ExecutorSessionID is required");
    }
    let current = ctx.config.read().await.clone();
    match reload_from_config_path(&current) {
        Ok(next) => {
            *ctx.config.write().await = next.clone();
            mcp_result(input, json!({ "ok": true, "config": config_view(&next) }))
        }
        Err(error) => mcp_invalid(input, &error.to_string()),
    }
}

fn executor_bound_args(input: &Value, params: &Value) -> std::result::Result<Value, String> {
    let mut args = params
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));
    if !args.is_object() {
        return Err("arguments must be an object".into());
    }
    copy_executor_field(&mut args, params, input, "ExecutorSessionID")?;
    copy_executor_field(&mut args, params, input, "ExecutorRuntimeID")?;
    require_non_empty(args.get("ExecutorSessionID"), "ExecutorSessionID")?;
    Ok(args)
}

fn copy_executor_field(
    args: &mut Value,
    params: &Value,
    input: &Value,
    name: &str,
) -> std::result::Result<(), String> {
    if non_empty(args.get(name)).is_some() {
        return Ok(());
    }
    let value = non_empty(params.get(name))
        .or_else(|| params.get("_meta").and_then(|m| non_empty(m.get(name))))
        .or_else(|| input.get("_meta").and_then(|m| non_empty(m.get(name))))
        .or_else(|| {
            if name == "ExecutorRuntimeID" {
                non_empty(params.get("runtimeID"))
            } else {
                None
            }
        });
    if let Some(value) = value {
        args[name] = Value::String(value.to_string());
    }
    Ok(())
}

fn require_non_empty(value: Option<&Value>, name: &str) -> std::result::Result<(), String> {
    non_empty(value)
        .map(|_| ())
        .ok_or_else(|| format!("{name} is required"))
}

fn non_empty(value: Option<&Value>) -> Option<&str> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
}

fn mcp_result(input: &Value, result: Value) -> HttpResponse {
    HttpResponse::json(json!({
        "jsonrpc": "2.0",
        "id": input.get("id").cloned().unwrap_or(Value::Null),
        "result": result,
    }))
}

fn mcp_error(input: &Value, message: &str) -> HttpResponse {
    HttpResponse::json(json!({
        "jsonrpc": "2.0",
        "id": input.get("id").cloned().unwrap_or(Value::Null),
        "error": { "code": -32601, "message": message },
    }))
}

fn mcp_invalid(input: &Value, message: &str) -> HttpResponse {
    HttpResponse::json(json!({
        "jsonrpc": "2.0",
        "id": input.get("id").cloned().unwrap_or(Value::Null),
        "error": { "code": -32602, "message": message },
    }))
}

async fn queue_response(
    ctx: &WebContext,
    body: &str,
) -> std::result::Result<QueuedResponse, String> {
    let request: RespondRequest = serde_json::from_str(body).map_err(|e| e.to_string())?;
    if request.session_id.is_empty() || request.request_id.is_empty() {
        return Err("sessionId/sessionID and requestId/requestID are required".into());
    }
    let cache = ctx.requestion_cache.read().await;
    let item = cache
        .get_for_web(&request.session_id, &request.request_id)
        .ok_or_else(|| "requestion not found in endpoint cache".to_string())?;
    let target = item.source.clone();
    let source = ctx.config.read().await.address.clone();
    let envelope = build_requestion_respond(&source, target, &request);
    drop(cache);
    ctx.outbound_tx
        .send(OutboundControl { envelope })
        .await
        .map_err(|_| "GV client is not accepting outbound controls".to_string())?;
    Ok(QueuedResponse {
        ok: true,
        subtype: "requestion_respond",
        session_id: request.session_id,
        request_id: request.request_id,
    })
}

struct HttpRequest {
    method: String,
    path: String,
    body: String,
}

fn parse_request(raw: &str) -> HttpRequest {
    let mut parts = raw.split("\r\n\r\n");
    let head = parts.next().unwrap_or("");
    let body = parts.next().unwrap_or("").to_string();
    let mut first = head.lines().next().unwrap_or("").split_whitespace();
    HttpRequest {
        method: first.next().unwrap_or("").to_string(),
        path: first
            .next()
            .unwrap_or("/")
            .split('?')
            .next()
            .unwrap_or("/")
            .to_string(),
        body,
    }
}

struct HttpResponse {
    status: &'static str,
    content_type: &'static str,
    body: String,
}

impl HttpResponse {
    fn ok(content_type: &'static str, body: &str) -> Self {
        Self {
            status: "200 OK",
            content_type,
            body: body.into(),
        }
    }

    fn json(value: Value) -> Self {
        Self {
            status: "200 OK",
            content_type: "application/json",
            body: value.to_string(),
        }
    }

    fn bad_request(message: &str) -> Self {
        Self {
            status: "400 Bad Request",
            content_type: "application/json",
            body: json!({ "ok": false, "error": message }).to_string(),
        }
    }

    fn not_found() -> Self {
        Self {
            status: "404 Not Found",
            content_type: "text/plain",
            body: "not found".into(),
        }
    }

    fn as_bytes(&self) -> Vec<u8> {
        format!(
            "HTTP/1.1 {}\r\ncontent-type: {}; charset=utf-8\r\ncontent-length: {}\r\naccess-control-allow-origin: *\r\nconnection: close\r\n\r\n{}",
            self.status,
            self.content_type,
            self.body.len(),
            self.body
        )
        .into_bytes()
    }
}
