use osgp::SessionAddress;
use serde_json::{json, Value};

use crate::{
    gv_client::GvClient,
    config::ConfigStore,
    mcp,
    session_bridge::BridgeServices,
    state::{EndpointConfig, SharedState},
};

#[tokio::test]
async fn mailbox_crud_reply_delete_and_sort_desc() {
    let bridge = BridgeServices::new();
    let config = ConfigStore::new(None, None);
    let state = SharedState::new();

    let first = call(
        &bridge,
        &config,
        &state,
        "SendMailboxItem",
        json!({
            "ExecutorRuntimeID": "rt-a", "ExecutorSessionID": "ses-a", "runtimeID": "rt-a", "sessionID": "ses-a", "senderRuntimeID": "rt-s",
            "senderSessionID": "ses-s", "senderSessionTitle": "Sender",
            "title": "first", "msg": "alpha", "type": "Notice"
        }),
    )
    .await;
    tokio::time::sleep(std::time::Duration::from_millis(2)).await;
    let second = call(
        &bridge,
        &config,
        &state,
        "SendMailboxItem",
        json!({
            "ExecutorRuntimeID": "rt-a", "ExecutorSessionID": "ses-a", "runtimeID": "rt-a", "sessionID": "ses-a", "senderRuntimeID": "rt-s",
            "senderSessionID": "ses-s", "senderSessionTitle": "Sender",
            "title": "second", "msg": "beta", "type": "NeedReplay"
        }),
    )
    .await;

    let first_id = str_field(&first, "itemID");
    let second_id = str_field(&second, "itemID");
    let replay_id = str_field(&second, "replayID");
    assert_ne!(first_id, second_id);

    let listed = call(
        &bridge,
        &config,
        &state,
        "ListMailboxItems",
        json!({
            "ExecutorRuntimeID": "rt-a", "ExecutorSessionID": "ses-a", "runtimeID": "rt-a", "sessionID": "ses-a", "size": 10
        }),
    )
    .await;
    let items = listed["list"].as_array().unwrap();
    assert_eq!(items.len(), 2);
    assert_eq!(items[0]["ItemID"], second_id);
    assert_eq!(items[1]["ItemID"], first_id);
    assert_eq!(items[0]["InfoType"], "NeedReplay");

    let read = call(
        &bridge,
        &state,
        "ReadMailboxItem",
        json!({ "ExecutorRuntimeID": "rt-a", "ExecutorSessionID": "ses-a", "itemID": second_id }),
    )
    .await;
    assert_eq!(read["hasRead"], true);
    assert_eq!(read["content"], "beta");

    let reply = call(
        &bridge,
        &state,
        "ReplyMailboxItem",
        json!({
            "ExecutorRuntimeID": "rt-a", "ExecutorSessionID": "ses-a", "replayID": replay_id, "msg": "reply body"
        }),
    )
    .await;
    assert_eq!(reply["ok"], true);

    let replied = call(
        &bridge,
        &state,
        "ReadMailboxItem",
        json!({ "ExecutorRuntimeID": "rt-a", "ExecutorSessionID": "ses-a", "itemID": second_id }),
    )
    .await;
    assert_eq!(replied["InfoType"], "Replaied");

    let deleted = call(
        &bridge,
        &state,
        "DeleteMailboxItem",
        json!({ "ExecutorRuntimeID": "rt-a", "ExecutorSessionID": "ses-a", "itemID": first_id }),
    )
    .await;
    assert_eq!(deleted["ok"], true);
    let missing = call(
        &bridge,
        &state,
        "DeleteMailboxItem",
        json!({ "ExecutorRuntimeID": "rt-a", "ExecutorSessionID": "ses-a", "itemID": first_id }),
    )
    .await;
    assert_eq!(missing["ok"], false);
}

#[tokio::test]
async fn mailbox_filters_regex_metadata_and_limit() {
    let bridge = BridgeServices::new();
    let state = SharedState::new();
    for (title, msg, ty) in [
        ("alpha task", "body one", "Notice"),
        ("beta task", "body two", "NeedReplay"),
        ("gamma note", "body three", "Notice"),
    ] {
        call(
            &bridge,
            &state,
            "SendMailboxItem",
            json!({
                "ExecutorRuntimeID": "rt-filter", "ExecutorSessionID": "ses-filter", "runtimeID": "rt-filter", "sessionID": "ses-filter", "senderRuntimeID": "rt-s",
                "senderSessionID": "sender-filter", "senderSessionTitle": "Filter Sender",
                "title": title, "msg": msg, "type": ty
            }),
        )
        .await;
    }

    let by_text = call(
        &bridge,
        &state,
        "ListMailboxItems",
        json!({
            "ExecutorRuntimeID": "rt-filter", "ExecutorSessionID": "ses-filter", "runtimeID": "rt-filter", "sessionID": "ses-filter", "regex": "beta", "size": 10
        }),
    )
    .await;
    assert_eq!(by_text["realsize"], 1);
    assert_eq!(by_text["list"][0]["title"], "beta task");

    let by_meta = call(&bridge, &state, "ListMailboxItems", json!({
        "ExecutorRuntimeID": "rt-filter", "ExecutorSessionID": "ses-filter", "runtimeID": "rt-filter", "sessionID": "ses-filter", "metadataRegex": "NeedReplay", "size": 10
    })).await;
    assert_eq!(by_meta["realsize"], 1);
    assert_eq!(by_meta["list"][0]["InfoType"], "NeedReplay");

    let limited = call(
        &bridge,
        &state,
        "ListMailboxItems",
        json!({
            "ExecutorRuntimeID": "rt-filter", "ExecutorSessionID": "ses-filter", "runtimeID": "rt-filter", "sessionID": "ses-filter", "size": 2
        }),
    )
    .await;
    assert_eq!(limited["realsize"], 3);
    assert_eq!(limited["list"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn mcp_lists_and_calls_bridge_tools() {
    let state = SharedState::new();
    let gv = GvClient::new(state.clone());
    let bridge = BridgeServices::new();

    let listed = mcp_call(
        &state,
        &gv,
        &bridge,
        json!({
            "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}
        }),
    )
    .await;
    let tools = listed["result"]["tools"].as_array().unwrap();
    assert!(tools.iter().all(|tool| tool.get("inputSchema").is_some()));
    assert!(tools.iter().any(|tool| tool["name"] == "ListMailboxItems"));
    assert!(tools.iter().any(|tool| tool["name"] == "DeleteMailboxItem"));
    let send_tool = tools
        .iter()
        .find(|tool| tool["name"] == "SendMailboxItem")
        .unwrap();
    assert!(send_tool["inputSchema"]["required"]
        .as_array()
        .unwrap()
        .contains(&json!("ExecutorSessionID")));
    let read_tool = tools
        .iter()
        .find(|tool| tool["name"] == "ReadMailboxItem")
        .unwrap();
    assert!(read_tool["inputSchema"]["properties"]
        .get("ExecutorSessionID")
        .is_some());

    let missing_executor = mcp_call(
        &state,
        &gv,
        &bridge,
        json!({
            "jsonrpc": "2.0", "id": 22, "method": "tools/call",
            "params": { "name": "SendMailboxItem", "arguments": {
                "runtimeID": "rt-mcp", "sessionID": "ses-mcp", "title": "mcp", "msg": "hello"
            }}
        }),
    )
    .await;
    assert!(missing_executor["error"]["message"]
        .as_str()
        .unwrap()
        .contains("ExecutorSessionID"));

    let sent = mcp_call(
        &state,
        &gv,
        &bridge,
        json!({
            "jsonrpc": "2.0", "id": 2, "method": "tools/call",
            "params": { "name": "SendMailboxItem", "arguments": {
                "ExecutorRuntimeID": "rt-mcp", "ExecutorSessionID": "ses-mcp", "runtimeID": "rt-mcp", "sessionID": "ses-mcp", "title": "mcp", "msg": "hello"
            }}
        }),
    )
    .await;
    assert_eq!(sent["result"]["ok"], true);

    let listed_items = mcp_call(
        &state,
        &gv,
        &bridge,
        json!({
            "jsonrpc": "2.0", "id": 3, "method": "tools/call",
            "params": { "name": "ListMailboxItems", "arguments": {
                "ExecutorRuntimeID": "rt-mcp", "ExecutorSessionID": "ses-mcp", "runtimeID": "rt-mcp", "sessionID": "ses-mcp", "size": 5
            }}
        }),
    )
    .await;
    assert_eq!(listed_items["result"]["realsize"], 1);
}

#[tokio::test]
async fn living_sessions_and_session_messages_use_fake_state() {
    let bridge = BridgeServices::new();
    let state = SharedState::new();
    state
        .set_config(EndpointConfig {
            router_url: "ws://127.0.0.1:7200".into(),
            node_id: "session-endpoint-test".into(),
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
    state.session_update(json!({
        "sessionId": "fake-ses", "runtime": "fake-rt", "state": "running", "title": "Fake Session"
    })).await;
    state
        .log(
            "response runtime_session_messages",
            json!({ "messages": ["hello"] }),
        )
        .await;

    let sessions = call(
        &bridge,
        &state,
        "ListLivingSessions",
        json!({ "ExecutorSessionID": "endpoint-ses", "regex": "fake", "list": 5 }),
    )
    .await;
    assert_eq!(sessions["realsize"], 1);
    assert_eq!(sessions["list"][0]["runtimeID"], "fake-rt");
    assert_eq!(sessions["list"][0]["sessionID"], "fake-ses");

    let messages = call(
        &bridge,
        &state,
        "GetSessionMessages",
        json!({ "regex": "hello", "limit": 5 }),
    )
    .await;
    assert_eq!(messages["realsize"], 1);
    assert_eq!(
        messages["list"][0]["type"],
        "response runtime_session_messages"
    );
}

async fn call(bridge: &BridgeServices, state: &SharedState, name: &str, args: Value) -> Value {
    bridge
        .call(name, args, state)
        .await
        .expect("tool ok")
        .expect("tool exists")
}

#[tokio::test]
async fn config_reload_updates_defaults_without_losing_mailbox() {
    let state = SharedState::new();
    let bridge = BridgeServices::new();
    let path = std::env::temp_dir().join(format!("session-endpoint-config-{}.json", std::process::id()));
    std::fs::write(&path, r#"{
        "listen":"127.0.0.1:19001",
        "router_url":"ws://127.0.0.1:7200",
        "node_id":"node-a",
        "source":{"domain":"surface","runtime":"source-a","session":"exec-a"},
        "target":{"domain":"domain-a","runtime":"target-a","session":"session-a"},
        "executor":{"runtime_id":"source-a","session_id":"exec-a"},
        "web_defaults":{"messageLimit":10}
    }"#).unwrap();
    let config = ConfigStore::new(Some(path.clone()), None);
    let loaded = config.load_initial(&state).await.unwrap();
    assert_eq!(loaded.endpoint.router_url, "ws://127.0.0.1:7200");
    call(&bridge, &state, "SendMailboxItem", json!({
        "ExecutorRuntimeID":"source-a", "ExecutorSessionID":"exec-a",
        "runtimeID":"source-a", "sessionID":"exec-a", "title":"keep", "msg":"state"
    })).await;

    std::fs::write(&path, r#"{
        "listen":"127.0.0.1:19002",
        "router_url":"ws://127.0.0.1:7201",
        "node_id":"node-b",
        "source":{"domain":"surface","runtime":"source-b","session":"exec-b"},
        "target":{"domain":"domain-b","runtime":"target-b","session":"session-b"},
        "executor":{"runtime_id":"source-b","session_id":"exec-b"},
        "web_defaults":{"messageLimit":25}
    }"#).unwrap();
    let reloaded = config.reload(&state).await.unwrap();
    assert_eq!(reloaded["config"]["endpoint"]["router_url"], "ws://127.0.0.1:7201");
    assert_eq!(state.snapshot().await.config.unwrap().target.runtime.unwrap(), "target-b");
    let kept = call(&bridge, &state, "ListMailboxItems", json!({
        "ExecutorRuntimeID":"source-a", "ExecutorSessionID":"exec-a", "size":5
    })).await;
    assert_eq!(kept["realsize"], 1);
    let _ = std::fs::remove_file(path);
}

async fn mcp_call(
    state: &SharedState,
    gv: &GvClient,
    bridge: &BridgeServices,
    config: &ConfigStore,
    request: Value,
) -> Value {
    let bytes = serde_json::to_vec(&request).unwrap();
    mcp::handle(state, gv, bridge, config, &bytes).await
}

fn str_field(value: &Value, key: &str) -> String {
    value[key].as_str().unwrap().to_string()
}
