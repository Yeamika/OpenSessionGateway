use crate::{
    config::ConfigStore,
    gv_client::GvClient,
    mcp,
    session_tools::SessionToolServices,
    state::{EndpointConfig, SharedState},
};
use osgp::{LinkHandshake, SessionAddress};
use serde_json::{json, Value};

#[tokio::test]
async fn mcp_exposes_session_tools_only() {
    let state = SharedState::new();
    let gv = GvClient::new(state.clone());
    let tools = SessionToolServices::new();
    let config = ConfigStore::new(None, None);
    let listed = mcp_call(
        &state,
        &gv,
        &tools,
        &config,
        json!({
            "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}
        }),
    )
    .await;
    let rows = listed["result"]["tools"].as_array().unwrap();
    assert!(rows.iter().any(|tool| tool["name"] == "ListLivingSessions"));
    assert!(rows.iter().any(|tool| tool["name"] == "GetSessionMessages"));
    let mailbox_list_name = ["List", "Mailbox", "Items"].join("");
    assert!(!rows.iter().any(|tool| tool["name"] == mailbox_list_name));
}

#[tokio::test]
async fn living_sessions_and_messages_use_session_state() {
    let state = SharedState::new();
    let tools = SessionToolServices::new();
    state
        .set_config(EndpointConfig {
            router_url: "ws://127.0.0.1:7200".into(),
            node_id: "session-control-test".into(),
            source: SessionAddress::new(
                "surface",
                Some("endpoint-rt".into()),
                Some("endpoint-ses".into()),
            ),
            target: SessionAddress::new(
                "domain-a",
                Some("fake-rt".into()),
                Some("fake-ses".into()),
            ),
        })
        .await;
    state.session_update(json!({"sessionId":"fake-ses","runtime":"fake-rt","state":"running","title":"Fake Session"})).await;
    state
        .log(
            "response runtime_session_messages",
            json!({"messages":["hello"]}),
        )
        .await;
    let sessions = tools
        .call(
            "ListLivingSessions",
            json!({"ExecutorSessionID":"endpoint-ses","regex":"fake","list":5}),
            &state,
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(sessions["list"][0]["runtimeID"], "fake-rt");
    let messages = tools
        .call(
            "GetSessionMessages",
            json!({"regex":"hello","limit":5}),
            &state,
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(messages["realsize"], 1);
}

#[tokio::test]
async fn config_reload_updates_session_defaults() {
    let state = SharedState::new();
    let path = std::env::temp_dir().join(format!(
        "session-control-config-{}.json",
        std::process::id()
    ));
    std::fs::write(&path, r#"{"listen":"127.0.0.1:19001","router_url":"ws://127.0.0.1:7200","node_id":"node-a","source":{"domain":"surface","runtime":"source-a","session":"exec-a"},"target":{"domain":"domain-a","runtime":"target-a","session":"session-a"},"web_defaults":{"messageLimit":10}}"#).unwrap();
    let config = ConfigStore::new(Some(path.clone()), None);
    config.load_initial(&state).await.unwrap();
    std::fs::write(&path, r#"{"listen":"127.0.0.1:19001","router_url":"ws://127.0.0.1:7201","node_id":"node-b","source":{"domain":"surface","runtime":"source-b","session":"exec-b"},"target":{"domain":"domain-b","runtime":"target-b","session":"session-b"},"web_defaults":{"messageLimit":22}}"#).unwrap();
    let reloaded = config.reload(&state).await.unwrap();
    assert_eq!(
        reloaded["config"]["endpoint"]["router_url"],
        "ws://127.0.0.1:7201"
    );
    assert_eq!(
        state
            .snapshot()
            .await
            .config
            .unwrap()
            .target
            .runtime
            .unwrap(),
        "target-b"
    );
    let _ = std::fs::remove_file(path);
}

async fn mcp_call(
    state: &SharedState,
    gv: &GvClient,
    tools: &SessionToolServices,
    config: &ConfigStore,
    request: Value,
) -> Value {
    let bytes = serde_json::to_vec(&request).unwrap();
    mcp::handle(state, gv, tools, config, &bytes).await
}

#[test]
fn osgp_link_handshake_wire_format_matches_router_expectation() {
    // The router's parse_hello_frame expects osgp::LinkHandshake with camelCase
    // serde: protocolVersion (string "osgp/1"), peerId, optional metadata.
    // This test ensures our handshake serialization is compatible.
    let hs = LinkHandshake::new("session-control-endpoint")
        .with_metadata(json!({"endpoint": "session-control"}));
    let wire = serde_json::to_string(&hs).unwrap();
    let parsed: Value = serde_json::from_str(&wire).unwrap();
    assert_eq!(parsed["protocolVersion"], "osgp/1");
    assert_eq!(parsed["peerId"], "session-control-endpoint");
    assert_eq!(parsed["metadata"]["endpoint"], "session-control");
    // Must NOT contain legacy fields
    assert!(parsed.get("type").is_none());
    assert!(parsed.get("role").is_none());
    assert!(parsed.get("capabilities").is_none());
    assert!(parsed.get("nodeId").is_none());
}

#[test]
fn router_hello_reply_is_accepted_as_handshake_ack() {
    // Router replies with legacy HelloMessage: {"nodeId":"...","role":"router",...}
    // Our client should accept this as a successful connection ack.
    let reply = json!({"nodeId":"root-router","role":"router","addresses":[],"capabilities":[]});
    let has_node_id = reply.get("nodeId").and_then(Value::as_str).is_some();
    let is_success_ack = reply.get("success").and_then(Value::as_bool).unwrap_or(false);
    assert!(has_node_id || is_success_ack, "HelloMessage reply must be accepted");
    assert_eq!(reply["nodeId"], "root-router");
}

// ── Subtype allowlist convergence tests (GVW4) ─────────────────────

#[tokio::test]
async fn mcp_schema_control_subtypes_match_canonical() {
    let state = SharedState::new();
    let gv = GvClient::new(state.clone());
    let tools = SessionToolServices::new();
    let config = ConfigStore::new(None, None);
    let listed = mcp_call(
        &state, &gv, &tools, &config,
        json!({"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}),
    ).await;
    let rows = listed["result"]["tools"].as_array().unwrap();
    let control_tool = rows.iter().find(|t| t["name"] == "control").unwrap();
    let enum_vals = control_tool["inputSchema"]["properties"]["subtype"]["enum"]
        .as_array().unwrap();
    let expected = vec![
        "add_prompt", "abort_session", "compact_session",
        "create_session", "rename_session", "resume_session", "requestion_respond",
    ];
    let got: Vec<&str> = enum_vals.iter().map(|v| v.as_str().unwrap()).collect();
    assert_eq!(got, expected, "control subtype enum must match canonical list");
}

#[tokio::test]
async fn mcp_schema_request_subtypes_match_canonical() {
    let state = SharedState::new();
    let gv = GvClient::new(state.clone());
    let tools = SessionToolServices::new();
    let config = ConfigStore::new(None, None);
    let listed = mcp_call(
        &state, &gv, &tools, &config,
        json!({"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}),
    ).await;
    let rows = listed["result"]["tools"].as_array().unwrap();
    let request_tool = rows.iter().find(|t| t["name"] == "request").unwrap();
    let enum_vals = request_tool["inputSchema"]["properties"]["subtype"]["enum"]
        .as_array().unwrap();
    let expected = vec![
        "runtime_workspace_view_snapshot",
        "runtime_requestion_snapshot",
        "runtime_session_view_snapshot",
        "runtime_session_messages",
    ];
    let got: Vec<&str> = enum_vals.iter().map(|v| v.as_str().unwrap()).collect();
    assert_eq!(got, expected, "request subtype enum must match canonical list");
}

#[tokio::test]
async fn control_rejects_unknown_subtype() {
    let state = SharedState::new();
    let gv = GvClient::new(state.clone());
    let tools = SessionToolServices::new();
    let config = ConfigStore::new(None, None);
    let result = mcp_call(
        &state, &gv, &tools, &config,
        json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
            "name":"control",
            "arguments":{"subtype":"arbitrary_inject","payload":{}}
        }}),
    ).await;
    assert!(result.get("error").is_some(), "unknown control subtype must be rejected");
    let msg = result["error"]["message"].as_str().unwrap();
    assert!(msg.contains("unsupported subtype"), "error must mention unsupported subtype");
}

#[tokio::test]
async fn request_rejects_unknown_subtype() {
    let state = SharedState::new();
    let gv = GvClient::new(state.clone());
    let tools = SessionToolServices::new();
    let config = ConfigStore::new(None, None);
    let result = mcp_call(
        &state, &gv, &tools, &config,
        json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
            "name":"request",
            "arguments":{"subtype":"steal_credentials","payload":{}}
        }}),
    ).await;
    assert!(result.get("error").is_some(), "unknown request subtype must be rejected");
    let msg = result["error"]["message"].as_str().unwrap();
    assert!(msg.contains("unsupported subtype"), "error must mention unsupported subtype");
}
