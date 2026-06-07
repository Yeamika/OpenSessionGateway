use super::*;
use serde_json::json;

fn self_request(method: &str, params: Value) -> Value {
    json!({ "id": 1, "method": method, "params": params })
}

fn tool_names(tools: &[Value]) -> Vec<&str> {
    tools
        .iter()
        .filter_map(|tool| tool.get("name").and_then(Value::as_str))
        .collect()
}

#[tokio::test]
async fn test_initialize_self() {
    let api = McpApi::new(TimerStore::new());
    let resp = api
        .handle_request(
            McpScope::Self_,
            "test-rt",
            self_request("initialize", json!({})),
        )
        .await;
    assert_eq!(resp["jsonrpc"], "2.0");
    assert_eq!(resp["result"]["protocolVersion"], "2025-03-26");
    assert_eq!(resp["result"]["serverInfo"]["name"], "timer_self");
}

#[tokio::test]
async fn test_initialize_manager() {
    let api = McpApi::new(TimerStore::new());
    let resp = api
        .handle_request(
            McpScope::Manager,
            "test-rt",
            self_request("initialize", json!({})),
        )
        .await;
    assert_eq!(resp["result"]["serverInfo"]["name"], "timer_manager");
}

#[tokio::test]
async fn test_tools_list_self() {
    let api = McpApi::new(TimerStore::new());
    let resp = api
        .handle_request(
            McpScope::Self_,
            "test-rt",
            self_request("tools/list", json!({})),
        )
        .await;
    let tools = resp["result"]["tools"].as_array().unwrap();
    let names = tool_names(tools);
    assert!(names.contains(&"CreateOneShotTimer"));
    assert!(names.contains(&"ListRuntimeTimers"));
    assert!(!names.contains(&"ListAllTimers"));
}

#[tokio::test]
async fn test_tools_list_manager_has_unique_current_tools() {
    let api = McpApi::new(TimerStore::new());
    let resp = api
        .handle_request(
            McpScope::Manager,
            "test-rt",
            self_request("tools/list", json!({})),
        )
        .await;
    let tools = resp["result"]["tools"].as_array().unwrap();
    let names = tool_names(tools);
    assert_eq!(
        names,
        vec![
            "CreateOneShotTimer",
            "DeleteRuntimeTimer",
            "ListRuntimeTimers",
            "ListAllTimers"
        ]
    );
}

#[tokio::test]
async fn test_executor_session_id_is_first_required_arg() {
    let api = McpApi::new(TimerStore::new());
    for scope in [McpScope::Self_, McpScope::Manager] {
        let resp = api
            .handle_request(scope, "test-rt", self_request("tools/list", json!({})))
            .await;
        for tool in resp["result"]["tools"].as_array().unwrap() {
            let required = tool["inputSchema"]["required"].as_array().unwrap();
            assert_eq!(required[0], "ExecutorSessionID", "{tool:?}");
        }
    }
}

#[tokio::test]
async fn test_create_one_shot_self_scope() {
    let api = McpApi::new(TimerStore::new());
    let resp = api
        .handle_request(
            McpScope::Self_,
            "my-runtime",
            self_request(
                "tools/call",
                json!({
                    "name": "CreateOneShotTimer",
                    "arguments": {
                        "ExecutorSessionID": "my-session",
                        "msg": "hello",
                        "afterSeconds": 30
                    }
                }),
            ),
        )
        .await;
    let text = resp["result"]["content"][0]["text"].as_str().unwrap();
    let result: Value = serde_json::from_str(text).unwrap();
    assert_eq!(result["ok"], true);
    assert_eq!(result["runtime_id"], "my-runtime");
    assert_eq!(result["session_id"], "my-session");
    assert_eq!(result["timer_type"], "one_shot");
    assert!(!result["timer_id"].as_str().unwrap().is_empty());
}

#[tokio::test]
async fn test_create_self_scope_uses_injected_executor_runtime_when_present() {
    let api = McpApi::new(TimerStore::new());
    let resp = api
        .handle_request(
            McpScope::Self_,
            "query-runtime",
            self_request(
                "tools/call",
                json!({
                    "name": "CreateOneShotTimer",
                    "arguments": {
                        "ExecutorRuntimeID": "injected-runtime",
                        "ExecutorSessionID": "injected-session",
                        "msg": "hello",
                        "afterSeconds": 30
                    }
                }),
            ),
        )
        .await;
    let text = resp["result"]["content"][0]["text"].as_str().unwrap();
    let result: Value = serde_json::from_str(text).unwrap();
    assert_eq!(result["runtime_id"], "injected-runtime");
    assert_eq!(result["session_id"], "injected-session");
}

#[tokio::test]
async fn test_create_and_list_and_delete() {
    let api = McpApi::new(TimerStore::new());

    let resp = api
        .handle_request(
            McpScope::Self_,
            "rt1",
            self_request(
                "tools/call",
                json!({
                    "name": "CreateOneShotTimer",
                    "arguments": {
                        "ExecutorSessionID": "ses1",
                        "msg": "test",
                        "afterSeconds": 60
                    }
                }),
            ),
        )
        .await;
    let text = resp["result"]["content"][0]["text"].as_str().unwrap();
    let created: Value = serde_json::from_str(text).unwrap();
    let timer_id = created["timer_id"].as_str().unwrap();

    let resp = api
        .handle_request(
            McpScope::Self_,
            "rt1",
            self_request(
                "tools/call",
                json!({
                    "name": "ListRuntimeTimers",
                    "arguments": { "ExecutorSessionID": "ses1" }
                }),
            ),
        )
        .await;
    let text = resp["result"]["content"][0]["text"].as_str().unwrap();
    let list_result: Value = serde_json::from_str(text).unwrap();
    assert_eq!(list_result["realsize"], 1);

    let resp = api
        .handle_request(
            McpScope::Self_,
            "rt1",
            self_request(
                "tools/call",
                json!({
                    "name": "DeleteRuntimeTimer",
                    "arguments": {
                        "ExecutorSessionID": "ses1",
                        "timerID": timer_id
                    }
                }),
            ),
        )
        .await;
    let text = resp["result"]["content"][0]["text"].as_str().unwrap();
    let delete_result: Value = serde_json::from_str(text).unwrap();
    assert_eq!(delete_result["ok"], true);

    let resp = api
        .handle_request(
            McpScope::Self_,
            "rt1",
            self_request(
                "tools/call",
                json!({
                    "name": "ListRuntimeTimers",
                    "arguments": { "ExecutorSessionID": "ses1" }
                }),
            ),
        )
        .await;
    let text = resp["result"]["content"][0]["text"].as_str().unwrap();
    let list_result: Value = serde_json::from_str(text).unwrap();
    assert_eq!(list_result["realsize"], 0);
}

#[tokio::test]
async fn test_list_all_timers_manager() {
    let api = McpApi::new(TimerStore::new());

    api.handle_request(
        McpScope::Self_,
        "rt1",
        self_request(
            "tools/call",
            json!({
                "name": "CreateOneShotTimer",
                "arguments": { "ExecutorSessionID": "ses1", "msg": "hi", "afterSeconds": 10 }
            }),
        ),
    )
    .await;

    let resp = api
        .handle_request(
            McpScope::Manager,
            "rt1",
            self_request(
                "tools/call",
                json!({
                    "name": "ListAllTimers",
                    "arguments": { "ExecutorSessionID": "admin" }
                }),
            ),
        )
        .await;
    let text = resp["result"]["content"][0]["text"].as_str().unwrap();
    let result: Value = serde_json::from_str(text).unwrap();
    assert_eq!(result["realsize"], 1);
}

#[tokio::test]
async fn test_unknown_method_returns_error() {
    let api = McpApi::new(TimerStore::new());
    let resp = api
        .handle_request(
            McpScope::Self_,
            "rt1",
            self_request("bogus/method", json!({})),
        )
        .await;
    assert!(resp.get("error").is_some());
    assert_eq!(resp["error"]["code"], -32601);
}

#[tokio::test]
async fn test_create_rejects_empty_msg() {
    let api = McpApi::new(TimerStore::new());
    let resp = api
        .handle_request(
            McpScope::Self_,
            "rt1",
            self_request(
                "tools/call",
                json!({
                    "name": "CreateOneShotTimer",
                    "arguments": { "ExecutorSessionID": "ses1", "msg": "", "afterSeconds": 10 }
                }),
            ),
        )
        .await;
    assert!(resp.get("error").is_some());
}

#[tokio::test]
async fn test_missing_injected_executor_session_id_returns_error() {
    let api = McpApi::new(TimerStore::new());
    let resp = api
        .handle_request(
            McpScope::Self_,
            "rt1",
            self_request(
                "tools/call",
                json!({
                    "name": "CreateOneShotTimer",
                    "arguments": { "msg": "hi", "afterSeconds": 10 }
                }),
            ),
        )
        .await;
    assert_eq!(resp["error"]["message"], "ExecutorSessionID is required");
}

#[tokio::test]
async fn test_periodic_returns_unsupported() {
    let api = McpApi::new(TimerStore::new());
    let resp = api
        .handle_request(
            McpScope::Self_,
            "rt1",
            self_request(
                "tools/call",
                json!({
                    "name": "CreatePeriodicTimer",
                    "arguments": { "ExecutorSessionID": "ses1", "msg": "hi", "everySeconds": 10 }
                }),
            ),
        )
        .await;
    assert!(resp.get("error").is_some());
    let msg = resp["error"]["message"].as_str().unwrap();
    assert!(msg.contains("not supported"));
}
