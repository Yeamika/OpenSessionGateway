use crate::{config::ConfigStore, mcp, state::SharedState, tools::MailboxToolServices};
use serde_json::{json, Value};
use std::{fs, path::PathBuf};

async fn call(tools: &MailboxToolServices, name: &str, args: Value) -> Value {
    tools
        .call(name, args)
        .await
        .expect("tool ok")
        .expect("known tool")
}

#[tokio::test]
async fn mailbox_crud_reply_delete_and_sort_desc() {
    let tools = MailboxToolServices::new();
    let first = call(
        &tools,
        "SendMailboxItem",
        json!({
            "ExecutorRuntimeID": "rt-caller", "ExecutorSessionID": "caller-a",
            "runtimeID": "rt-target", "sessionID": "target-a",
            "title": "first", "msg": "alpha", "type": "Notice"
        }),
    )
    .await;
    tokio::time::sleep(std::time::Duration::from_millis(2)).await;
    let second = call(
        &tools,
        "SendMailboxItem",
        json!({
            "ExecutorRuntimeID": "rt-caller", "ExecutorSessionID": "caller-a",
            "runtimeID": "rt-target", "sessionID": "target-a",
            "title": "second", "msg": "beta", "type": "NeedReplay"
        }),
    )
    .await;

    let list = call(
        &tools,
        "ListMailboxItems",
        json!({
            "ExecutorRuntimeID": "rt-target", "ExecutorSessionID": "target-a", "size": 10
        }),
    )
    .await;
    let items = list["list"].as_array().expect("items");
    assert_eq!(items.len(), 2);
    assert_eq!(items[0]["title"], "second");
    assert_eq!(items[1]["ItemID"], first["itemID"]);
    assert_eq!(items[0]["InfoType"], "NeedReplay");

    let read = call(&tools, "ReadMailboxItem", json!({
        "ExecutorRuntimeID": "rt-target", "ExecutorSessionID": "target-a", "itemID": second["itemID"]
    })).await;
    assert_eq!(read["content"], "beta");
    assert_eq!(read["hasRead"], true);

    let reminders = call(
        &tools,
        "MailboxReminders",
        json!({
            "ExecutorRuntimeID": "rt-target", "ExecutorSessionID": "target-a"
        }),
    )
    .await;
    assert_eq!(reminders["count"], 0);

    let reply = call(
        &tools,
        "ReplyMailboxItem",
        json!({
            "ExecutorRuntimeID": "rt-target", "ExecutorSessionID": "target-a",
            "replayID": second["replayID"], "msg": "answer"
        }),
    )
    .await;
    assert_eq!(reply["ok"], true);

    let caller_list = call(
        &tools,
        "ListMailboxItems",
        json!({
            "ExecutorRuntimeID": "rt-caller", "ExecutorSessionID": "caller-a", "size": 10
        }),
    )
    .await;
    assert_eq!(
        caller_list["list"][0]["InfoType"]
            .as_str()
            .unwrap()
            .starts_with("QuestReply("),
        true
    );

    let delete = call(&tools, "DeleteMailboxItem", json!({
        "ExecutorRuntimeID": "rt-target", "ExecutorSessionID": "target-a", "itemID": first["itemID"]
    })).await;
    assert_eq!(delete["ok"], true);
}

#[tokio::test]
async fn caller_bucket_is_not_target_identity() {
    let tools = MailboxToolServices::new();
    call(
        &tools,
        "SendMailboxItem",
        json!({
            "ExecutorSessionID": "sender", "runtimeID": "rt-x", "sessionID": "recipient",
            "title": "boundary", "msg": "payload"
        }),
    )
    .await;
    let sender_list = call(
        &tools,
        "ListMailboxItems",
        json!({ "ExecutorSessionID": "sender" }),
    )
    .await;
    let recipient_list = call(
        &tools,
        "ListMailboxItems",
        json!({ "ExecutorSessionID": "recipient" }),
    )
    .await;
    assert_eq!(sender_list["realsize"], 0);
    assert_eq!(recipient_list["realsize"], 1);
}

#[tokio::test]
async fn mcp_lists_and_calls_mailbox_tools() {
    let state = SharedState::new();
    let tools = MailboxToolServices::new();
    let config = ConfigStore::new(None, None);
    config.load_initial(&state).await.expect("config");
    let list = mcp::handle(
        &state,
        &tools,
        &config,
        br#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#,
    )
    .await;
    assert!(list["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .any(|tool| tool["name"] == "ListMailboxItems"));
    let send = mcp::handle(&state, &tools, &config, br#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"SendMailboxItem","arguments":{"ExecutorSessionID":"sender","runtimeID":"rt","sessionID":"target","title":"mcp","msg":"body"}}}"#).await;
    assert_eq!(send["result"]["ok"], true);
}

#[tokio::test]
async fn config_reload_updates_defaults_without_losing_mailbox() {
    let path = temp_path("mailbox-config-reload.json");
    fs::write(
        &path,
        r#"{"listen":"127.0.0.1:7312","executor":{"runtime_id":"rt-a","session_id":"ses-a"}}"#,
    )
    .unwrap();
    let state = SharedState::new();
    let config = ConfigStore::new(Some(path.clone()), None);
    let initial = config.load_initial(&state).await.unwrap();
    assert_eq!(initial.executor_session_id.as_deref(), Some("ses-a"));

    let tools = MailboxToolServices::new();
    call(&tools, "SendMailboxItem", json!({
        "ExecutorSessionID": "sender", "runtimeID": "rt", "sessionID": "target", "title": "kept", "msg": "body"
    })).await;
    fs::write(
        &path,
        r#"{"listen":"127.0.0.1:7313","executor":{"runtime_id":"rt-b","session_id":"ses-b"}}"#,
    )
    .unwrap();
    let reloaded = config.reload(&state).await.unwrap();
    assert_eq!(reloaded["config"]["executor_session_id"], "ses-b");
    let target = call(
        &tools,
        "ListMailboxItems",
        json!({ "ExecutorSessionID": "target" }),
    )
    .await;
    assert_eq!(target["realsize"], 1);
    let _ = fs::remove_file(path);
}

fn temp_path(name: &str) -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!("glassvein-{name}-{}", std::process::id()));
    path
}
