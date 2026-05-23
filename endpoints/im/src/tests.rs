use crate::{gv::GvClient, state::AppState};
use serde_json::{json, Value};

fn ex(mut v: Value) -> Value {
    v["ExecutorSessionID"] = json!("exec-test-session");
    v["ExecutorRuntimeID"] = json!("exec-test-runtime");
    v
}

mod state_tests {
    use super::*;

    async fn app() -> AppState {
        AppState::new(GvClient::test())
    }
    fn account() -> Value {
        ex(
            json!({"provider":"local","accountID":"acct","displayName":"Acct","enabled":true,"config":{"defaultChatID":"chat0","defaultChatName":"Chat Zero"}}),
        )
    }

    #[tokio::test]
    async fn account_crud_and_gv_recording() {
        let app = app().await;
        app.call_tool("control", "UpsertAccount", account())
            .await
            .unwrap();
        assert_eq!(
            app.call_tool("control", "ListAccounts", json!({}))
                .await
                .unwrap()["count"],
            1
        );
        let listed = app
            .call_tool("control", "ListAccounts", json!({}))
            .await
            .unwrap();
        assert_eq!(
            listed["items"][0]["executor"]["ExecutorSessionID"],
            "exec-test-session"
        );
        app.call_tool(
            "control",
            "DeleteAccount",
            ex(json!({"provider":"local","accountID":"acct"})),
        )
        .await
        .unwrap();
        assert_eq!(
            app.call_tool("control", "ListAccounts", json!({}))
                .await
                .unwrap()["count"],
            0
        );
        assert!(app
            .recorded_gv()
            .await
            .iter()
            .any(|e| e.link_type == "control" && e.subtype.contains("UpsertAccount")));
    }

    #[tokio::test]
    async fn missing_executor_is_clear_error() {
        let app = app().await;
        let err = app
            .call_tool(
                "control",
                "UpsertAccount",
                json!({"provider":"local","accountID":"x"}),
            )
            .await
            .unwrap_err();
        assert!(err.to_string().contains("ExecutorSessionID is required"));
    }

    #[tokio::test]
    async fn chat_crud_and_members() {
        let app = app().await;
        app.call_tool("control", "UpsertAccount", account())
            .await
            .unwrap();
        let chat = app.call_tool("control", "CreateAccountChat", ex(json!({"provider":"local","accountID":"acct","name":"Room","uuid":"room","userIDs":["u1"]}))).await.unwrap();
        assert_eq!(chat["chatID"], "room");
        app.call_tool("control", "AddAccountChatMembers", ex(json!({"provider":"local","accountID":"acct","chatID":"room","memberIDs":["u2"],"memberIDType":"user_id"}))).await.unwrap();
        let members = app
            .call_tool(
                "control",
                "ListAccountChatMembers",
                json!({"provider":"local","accountID":"acct","chatID":"room"}),
            )
            .await
            .unwrap();
        assert_eq!(members["total"], 2);
        app.call_tool(
            "control",
            "DeleteAccountChat",
            ex(json!({"provider":"local","accountID":"acct","chatID":"room"})),
        )
        .await
        .unwrap();
        assert_eq!(
            app.call_tool(
                "control",
                "ListAccountChats",
                json!({"provider":"local","accountID":"acct"})
            )
            .await
            .unwrap()["count"],
            1
        );
    }

    #[tokio::test]
    async fn binding_and_route_crud() {
        let app = app().await;
        app.call_tool("control", "UpsertAccount", account())
            .await
            .unwrap();
        app.call_tool(
            "control",
            "CreateSessionBinding",
            ex(json!({"sessionBindingID":"b","runtimeID":"r","directory":"/tmp"})),
        )
        .await
        .unwrap();
        let route = app.call_tool("control", "UpsertRoute", ex(json!({"provider":"local","accountID":"acct","chatID":"chat0","chatName":"Chat","sessionBindingID":"b"}))).await.unwrap();
        let id = route["routeID"].as_str().unwrap();
        assert_eq!(
            app.call_tool("control", "GetRoute", json!({"routeID":id}))
                .await
                .unwrap()["routeID"],
            id
        );
        assert!(app
            .call_tool(
                "control",
                "DeleteSessionBinding",
                ex(json!({"sessionBindingID":"b"}))
            )
            .await
            .is_err());
        app.call_tool("control", "DeleteRoute", ex(json!({"routeID":id})))
            .await
            .unwrap();
        app.call_tool(
            "control",
            "DeleteSessionBinding",
            ex(json!({"sessionBindingID":"b"})),
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn messages_upload_download_and_events() {
        let app = app().await;
        app.call_tool("control", "UpsertAccount", account())
            .await
            .unwrap();
        let route = app
            .call_tool(
                "control",
                "UpsertRoute",
                ex(json!({"provider":"local","accountID":"acct","chatID":"chat0"})),
            )
            .await
            .unwrap();
        let route_id = route["routeID"].as_str().unwrap();
        app.call_tool(
            "chat",
            "SendRouteTextMessage",
            ex(json!({"routeID":route_id,"text":"hello"})),
        )
        .await
        .unwrap();
        assert_eq!(
            app.call_tool("chat", "ListRouteMessages", ex(json!({"routeID":route_id})))
                .await
                .unwrap()["count"],
            1
        );
        let up = app
            .call_tool(
                "chat",
                "RequestUpload",
                ex(json!({"routeID":route_id,"type":"image"})),
            )
            .await
            .unwrap();
        app.write_upload(
            up["uploadID"].as_str().unwrap(),
            "a.txt",
            "text/plain",
            b"abc",
        )
        .await
        .unwrap();
        let sent = app
            .call_tool(
                "chat",
                "SendRouteUpload",
                ex(json!({"routeID":route_id,"uploadID":up["uploadID"]})),
            )
            .await
            .unwrap();
        let asset = app
            .call_tool(
                "chat",
                "RequestDownload",
                ex(json!({"routeID":route_id,"messageID":sent["messageID"],"type":"image"})),
            )
            .await
            .unwrap();
        let (_ct, body) = app
            .read_asset(asset["assetID"].as_str().unwrap())
            .await
            .unwrap();
        assert!(!body.is_empty());
        assert!(
            app.call_tool(
                "chat",
                "ListRecentRouteEvents",
                ex(json!({"routeID":route_id}))
            )
            .await
            .unwrap()["count"]
                .as_u64()
                .unwrap()
                >= 1
        );
    }

    #[tokio::test]
    async fn feishu_mock_and_real_boundary() {
        let app = app().await;
        app.call_tool(
            "control",
            "UpsertAccount",
            ex(json!({"provider":"feishu","accountID":"mock","config":{"mock":true}})),
        )
        .await
        .unwrap();
        let err = app
            .call_tool(
                "control",
                "UpsertAccount",
                ex(json!({"provider":"feishu","accountID":"real","config":{"mock":false}})),
            )
            .await
            .unwrap_err();
        assert!(err.to_string().contains("config-file credentials"));
    }
}

#[tokio::test]
async fn tools_list_schema_has_executor_for_tracked_tools() {
    let state = AppState::new(GvClient::test());
    let body = br#"{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}"#;
    let control = crate::api::handle_rpc("control", body, state.clone())
        .await
        .unwrap();
    let chat = crate::api::handle_rpc("chat", body, state).await.unwrap();
    let upsert = control["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["name"] == "UpsertAccount")
        .unwrap();
    assert!(upsert["inputSchema"]["required"]
        .as_array()
        .unwrap()
        .contains(&json!("ExecutorSessionID")));
    let list_accounts = control["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["name"] == "ListAccounts")
        .unwrap();
    assert!(list_accounts["inputSchema"]["required"]
        .as_array()
        .unwrap()
        .is_empty());
    let list_messages = chat["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["name"] == "ListRouteMessages")
        .unwrap();
    assert!(list_messages["inputSchema"]["required"]
        .as_array()
        .unwrap()
        .contains(&json!("ExecutorSessionID")));
}

#[tokio::test]
async fn no_config_starts_and_feishu_smoke_skips() {
    let cfg = crate::im_config::load_config(None).unwrap();
    let result = crate::feishu::smoke_from_config(&cfg, None, false)
        .await
        .unwrap();
    assert_eq!(result["realSmoke"], "SKIPPED_NO_FEISHU_ACCOUNT");
}

#[tokio::test]
async fn config_reload_multi_account_update_disable() {
    let dir = std::env::temp_dir();
    let path = dir.join(format!("gv-im-config-{}.json", std::process::id()));
    let first = json!({"accounts":[
        {"provider":"local","accountID":"local-a","displayName":"Local A","enabled":true,"config":{"defaultChatID":"a"}},
        {"provider":"feishu","accountID":"f-a","displayName":"Feishu A","enabled":true,"credentials":{"appId":"placeholder","appSecret":"placeholder"},"test":{"chatID":"placeholder","allowSendSmoke":false}},
        {"provider":"feishu","accountID":"f-b","displayName":"Feishu B","enabled":true,"credentials":{"appId":"placeholder","appSecret":"placeholder"}}
    ]});
    std::fs::write(&path, serde_json::to_string(&first).unwrap()).unwrap();
    let app = AppState::new(GvClient::test());
    app.set_config_path(Some(path.clone())).await;
    app.reload_config().await.unwrap();
    assert_eq!(
        app.call_tool("control", "ListAccounts", json!({}))
            .await
            .unwrap()["count"],
        3
    );
    let second = json!({"accounts":[
        {"provider":"local","accountID":"local-a","displayName":"Local Updated","enabled":true,"config":{"defaultChatID":"a"}},
        {"provider":"feishu","accountID":"f-a","displayName":"Feishu Disabled","enabled":false,"credentials":{"appId":"placeholder","appSecret":"placeholder"}},
        {"provider":"feishu","accountID":"f-c","displayName":"Feishu C","enabled":true,"credentials":{"appId":"placeholder","appSecret":"placeholder"}}
    ]});
    std::fs::write(&path, serde_json::to_string(&second).unwrap()).unwrap();
    let reloaded = app.reload_config().await.unwrap();
    assert_eq!(reloaded["activeAccounts"], 2);
    let listed = app
        .call_tool("control", "ListAccounts", json!({}))
        .await
        .unwrap();
    let text = serde_json::to_string(&listed).unwrap();
    assert!(text.contains("local-a") && text.contains("f-c") && !text.contains("f-b"));
    assert!(!text.contains("placeholder"));
    let _ = std::fs::remove_file(path);
}
