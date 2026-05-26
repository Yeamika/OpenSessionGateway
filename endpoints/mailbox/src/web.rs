use crate::{config::ConfigStore, mcp, state::SharedState, tools::MailboxToolServices};
use anyhow::{Context, Result};
use serde_json::{json, Value};
use std::net::SocketAddr;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};

const INDEX: &str = include_str!("../web/index.html");
const APP: &str = include_str!("../web/app.js");
const STYLES: &str = include_str!("../web/styles.css");

pub async fn serve(
    addr: SocketAddr,
    state: SharedState,
    tools: MailboxToolServices,
    config: ConfigStore,
) -> Result<()> {
    let listener = TcpListener::bind(addr).await?;
    loop {
        let (stream, _) = listener.accept().await?;
        let state = state.clone();
        let tools = tools.clone();
        let config = config.clone();
        tokio::spawn(async move {
            if let Err(error) = handle(stream, state, tools, config).await {
                tracing::warn!(error = %error, "HTTP request failed");
            }
        });
    }
}

async fn handle(
    mut stream: TcpStream,
    state: SharedState,
    tools: MailboxToolServices,
    config: ConfigStore,
) -> Result<()> {
    let mut buffer = vec![0_u8; 1024 * 1024];
    let read = stream.read(&mut buffer).await?;
    let request = std::str::from_utf8(&buffer[..read]).context("request is not UTF-8")?;
    let (head, body) = split_request(request, &buffer[..read])?;
    let mut parts = head.lines().next().unwrap_or_default().split_whitespace();
    let method = parts.next().unwrap_or_default();
    let path = parts.next().unwrap_or("/");
    let response = route(method, path, body, &state, &tools, &config).await;
    let (status, content_type, payload) = match response {
        Ok(value) => value,
        Err(error) => (
            500,
            "application/json",
            json!({ "ok": false, "error": error.to_string() }).to_string(),
        ),
    };
    write_response(&mut stream, status, content_type, payload.as_bytes()).await
}

async fn route(
    method: &str,
    path: &str,
    body: &[u8],
    state: &SharedState,
    tools: &MailboxToolServices,
    config: &ConfigStore,
) -> Result<(u16, &'static str, String)> {
    match (method, path) {
        ("GET", "/") => Ok((200, "text/html; charset=utf-8", INDEX.into())),
        ("GET", "/app.js") => Ok((200, "text/javascript; charset=utf-8", APP.into())),
        ("GET", "/styles.css") => Ok((200, "text/css; charset=utf-8", STYLES.into())),
        ("GET", "/api/status") => json_response(serde_json::to_value(state.snapshot().await)?),
        ("GET", "/api/config") => {
            json_response(serde_json::to_value(state.snapshot().await.runtime_config)?)
        }
        ("POST", "/api/config/reload") => json_response(config.reload(state).await?),
        ("POST", "/api/mailbox/list") => call_json(tools, "ListMailboxItems", body).await,
        ("POST", "/api/mailbox/read") => call_json(tools, "ReadMailboxItem", body).await,
        ("POST", "/api/mailbox/send") => call_json(tools, "SendMailboxItem", body).await,
        ("POST", "/api/mailbox/reply") => call_json(tools, "ReplyMailboxItem", body).await,
        ("POST", "/api/mailbox/delete") => call_json(tools, "DeleteMailboxItem", body).await,
        ("POST", "/api/mailbox/reminders") => call_json(tools, "MailboxReminders", body).await,
        ("POST", "/api/v2/mcp/mailbox") | ("POST", "/mcp") => {
            json_response(mcp::handle(state, tools, config, body).await)
        }
        _ => Ok((
            404,
            "application/json",
            json!({ "ok": false, "error": "not found" }).to_string(),
        )),
    }
}

async fn call_json(
    tools: &MailboxToolServices,
    name: &str,
    body: &[u8],
) -> Result<(u16, &'static str, String)> {
    let args: Value = serde_json::from_slice(body)?;
    let value = tools.call(name, args).await?.unwrap_or_else(|| json!(null));
    json_response(value)
}

fn split_request<'a>(request: &'a str, bytes: &'a [u8]) -> Result<(&'a str, &'a [u8])> {
    let split = request.find("\r\n\r\n").context("invalid HTTP request")?;
    Ok((&request[..split], &bytes[split + 4..]))
}

fn json_response(value: Value) -> Result<(u16, &'static str, String)> {
    Ok((200, "application/json", value.to_string()))
}

async fn write_response(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    body: &[u8],
) -> Result<()> {
    let reason = if status == 200 {
        "OK"
    } else if status == 404 {
        "Not Found"
    } else {
        "Error"
    };
    let head = format!("HTTP/1.1 {status} {reason}\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n", body.len());
    stream.write_all(head.as_bytes()).await?;
    stream.write_all(body).await?;
    Ok(())
}
