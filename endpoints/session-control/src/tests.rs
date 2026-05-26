use crate::{
    config::ConfigStore,
    gv_client::GvClient,
    mcp,
    session_tools::SessionToolServices,
    state::{EndpointConfig, SharedState},
};
use osgp::SessionAddress;
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
