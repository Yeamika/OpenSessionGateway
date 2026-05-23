use super::*;
use osgp::SessionAddress;
use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

fn addr(runtime: &str, session: &str) -> SessionAddress {
    SessionAddress::new("domain-a", Some(runtime.into()), Some(session.into()))
}

fn config() -> CliConfig {
    CliConfig {
        node_id: "requestion-endpoint".into(),
        router_url: "ws://127.0.0.1:7200".into(),
        address: addr("requestion-endpoint", "requestion-endpoint"),
        web_addr: "127.0.0.1:0".into(),
        no_web: false,
        config_path: None,
        seed_demo: false,
    }
}

async fn context_with_one() -> (WebContext, mpsc::Receiver<OutboundControl>) {
    let session_cache = Arc::new(RwLock::new(SessionStateCache::new()));
    let requestion_cache = Arc::new(RwLock::new(RequestionCache::new()));
    requestion_cache.write().await.upsert(
        "ses-a".into(),
        "req-a".into(),
        "Approve A".into(),
        addr("runtime-a", "ses-a"),
        "requestion.asked".into(),
        json!({"sessionID":"ses-a","requestID":"req-a"}),
    );
    let (tx, rx) = mpsc::channel(4);
    (
        WebContext {
            config: Arc::new(RwLock::new(config())),
            session_cache,
            requestion_cache,
            outbound_tx: tx,
        },
        rx,
    )
}

#[tokio::test]
async fn api_lists_flat_and_grouped_pending_requestions() {
    let (ctx, _rx) = context_with_one().await;
    let response = requestions_json(&ctx).await;
    let body: Value = serde_json::from_str(&response.body).unwrap();
    assert_eq!(body["requestions"].as_array().unwrap().len(), 1);
    assert_eq!(
        body["groupedBySession"]["ses-a"].as_array().unwrap().len(),
        1
    );
}

#[tokio::test]
async fn api_respond_queues_control_to_original_source() {
    let (ctx, mut rx) = context_with_one().await;
    let response = respond_json(
        &ctx,
        r#"{"sessionID":"ses-a","requestID":"req-a","decision":"approve"}"#,
    )
    .await;
    let body: Value = serde_json::from_str(&response.body).unwrap();
    assert_eq!(body["ok"], true);
    let outbound = rx.recv().await.unwrap();
    assert_eq!(outbound.envelope.target, addr("runtime-a", "ses-a"));
    assert_eq!(outbound.envelope.subtype, "requestion_respond");
    assert_eq!(outbound.envelope.payload["answers"][0][0], "approve");
}

#[tokio::test]
async fn api_respond_rejects_unknown_requestion() {
    let (ctx, mut rx) = context_with_one().await;
    let response = respond_json(
        &ctx,
        r#"{"sessionId":"ses-a","requestId":"missing","decision":"reject"}"#,
    )
    .await;
    assert_eq!(response.status, "400 Bad Request");
    assert!(rx.try_recv().is_err());
}

#[tokio::test]
async fn mcp_tools_and_call_paths_work() {
    let (ctx, _rx) = context_with_one().await;
    let tools = mcp_json(
        &ctx,
        r#"{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}"#,
    )
    .await;
    let tools_body: Value = serde_json::from_str(&tools.body).unwrap();
    assert_eq!(tools_body["result"]["tools"][0]["name"], "list_requestions");
    let schema = &tools_body["result"]["tools"][1]["inputSchema"];
    assert!(schema["required"]
        .as_array()
        .unwrap()
        .contains(&json!("ExecutorSessionID")));

    let listed = mcp_json(
        &ctx,
        r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_requestions","arguments":{}}}"#,
    )
    .await;
    let listed_body: Value = serde_json::from_str(&listed.body).unwrap();
    assert_eq!(
        listed_body["result"]["requestions"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn mcp_respond_requires_executor_session_id() {
    let (ctx, mut rx) = context_with_one().await;
    let response = mcp_json(
        &ctx,
        r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"respond_requestion","arguments":{"sessionID":"ses-a","requestID":"req-a","decision":"approve"}}}"#,
    )
    .await;
    let body: Value = serde_json::from_str(&response.body).unwrap();
    assert_eq!(body["error"]["code"], -32602);
    assert!(body["error"]["message"]
        .as_str()
        .unwrap()
        .contains("ExecutorSessionID"));
    assert!(rx.try_recv().is_err());
}

#[tokio::test]
async fn mcp_respond_uses_explicit_executor_session_id() {
    let (ctx, mut rx) = context_with_one().await;
    let response = mcp_json(
        &ctx,
        r#"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"respond_requestion","arguments":{"ExecutorSessionID":"caller-ses","ExecutorRuntimeID":"caller-rt","sessionID":"ses-a","requestID":"req-a","decision":"reject"}}}"#,
    )
    .await;
    let body: Value = serde_json::from_str(&response.body).unwrap();
    assert!(body.get("error").is_none());
    let outbound = rx.recv().await.unwrap();
    assert_eq!(outbound.envelope.target, addr("runtime-a", "ses-a"));
    assert_eq!(outbound.envelope.payload["ExecutorSessionID"], "caller-ses");
    assert_eq!(outbound.envelope.payload["ExecutorRuntimeID"], "caller-rt");
    assert_eq!(outbound.envelope.payload["answers"][0][0], "deny");
}

#[tokio::test]
async fn mcp_respond_accepts_auto_injected_executor_session_id() {
    let (ctx, mut rx) = context_with_one().await;
    let response = mcp_json(
        &ctx,
        r#"{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"respond_requestion","ExecutorSessionID":"auto-ses","arguments":{"sessionID":"ses-a","requestID":"req-a","decision":"response","response":"hello"}}}"#,
    )
    .await;
    let body: Value = serde_json::from_str(&response.body).unwrap();
    assert!(body.get("error").is_none());
    let outbound = rx.recv().await.unwrap();
    assert_eq!(outbound.envelope.payload["ExecutorSessionID"], "auto-ses");
    assert_eq!(outbound.envelope.payload["answers"][0][0], "hello");
}

#[tokio::test]
async fn mcp_respond_accepts_runtime_id_query_convention_for_executor_runtime() {
    let (ctx, mut rx) = context_with_one().await;
    let response = mcp_json(
        &ctx,
        r#"{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"respond_requestion","ExecutorSessionID":"auto-ses","runtimeID":"caller-rt","arguments":{"sessionID":"ses-a","requestID":"req-a","decision":"approve"}}}"#,
    )
    .await;
    let body: Value = serde_json::from_str(&response.body).unwrap();
    assert!(body.get("error").is_none());
    let outbound = rx.recv().await.unwrap();
    assert_eq!(outbound.envelope.payload["ExecutorRuntimeID"], "caller-rt");
}

#[tokio::test]
async fn api_reload_config_updates_source_and_preserves_pending_cache() {
    let (ctx, mut rx) = context_with_one().await;
    let path = temp_config_path();
    fs::write(
        &path,
        r#"{
        "nodeId":"requestion-reloaded",
        "routerUrl":"ws://127.0.0.1:7299",
        "address":"domain-a/reloaded-runtime/reloaded-session",
        "webAddr":"127.0.0.1:17399",
        "noWeb":false
    }"#,
    )
    .unwrap();
    ctx.config.write().await.config_path = Some(path.clone());

    let response = reload_config_json(&ctx).await;
    let body: Value = serde_json::from_str(&response.body).unwrap();
    assert_eq!(body["ok"], true);
    assert_eq!(body["config"]["routerUrl"], "ws://127.0.0.1:7299");
    assert_eq!(ctx.requestion_cache.read().await.get_all().len(), 1);

    let respond = respond_json(
        &ctx,
        r#"{"sessionID":"ses-a","requestID":"req-a","decision":"approve"}"#,
    )
    .await;
    assert_eq!(
        serde_json::from_str::<Value>(&respond.body).unwrap()["ok"],
        true
    );
    let outbound = rx.recv().await.unwrap();
    assert_eq!(
        outbound.envelope.source,
        addr("reloaded-runtime", "reloaded-session")
    );
    assert_eq!(outbound.envelope.target, addr("runtime-a", "ses-a"));
    let _ = fs::remove_file(path);
}

#[tokio::test]
async fn mcp_reload_config_requires_executor_session_id() {
    let (ctx, _rx) = context_with_one().await;
    let response = mcp_json(
        &ctx,
        r#"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"ReloadConfig","arguments":{}}}"#,
    ).await;
    let body: Value = serde_json::from_str(&response.body).unwrap();
    assert_eq!(body["error"]["code"], -32602);
}

#[test]
fn routes_static_and_not_found_paths() {
    let index = HttpResponse::ok("text/html", INDEX_HTML);
    assert!(index.body.contains("requestion-endpoint"));
    let not_found = HttpResponse::not_found();
    assert_eq!(not_found.status, "404 Not Found");
}

fn temp_config_path() -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("requestion-web-config-{stamp}.json"))
}
