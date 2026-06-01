//! MCP JSON-RPC 2.0 API handlers.
//!
//! Supports `initialize`, `tools/list`, `tools/call` for both
//! self (`/mcp/timer_scheduler`) and manager (`/mcp/timer_manager`) scopes.

use anyhow::{bail, Result};
use serde_json::{json, Value};

use crate::timer_store::TimerStore;

/// MCP scope: self (per-runtime) or manager (cross-runtime).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum McpScope {
    Self_,
    Manager,
}

/// Shared MCP handler. Holds a reference to the timer store.
#[derive(Clone)]
pub struct McpApi {
    store: TimerStore,
}

impl McpApi {
    pub fn new(store: TimerStore) -> Self {
        Self { store }
    }

    /// Handle a JSON-RPC request body. Returns the full JSON-RPC response.
    pub async fn handle_request(
        &self,
        scope: McpScope,
        runtime_id: &str,
        body: Value,
    ) -> Value {
        let id = body.get("id").cloned().unwrap_or(Value::Null);
        let method = body
            .get("method")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let params = body.get("params").cloned().unwrap_or(json!({}));

        match method.as_str() {
            "initialize" => self.handle_initialize(id, scope),
            "tools/list" => self.handle_tools_list(id, scope),
            "tools/call" => {
                self.handle_tools_call(id, scope, runtime_id, params)
                    .await
            }
            _ => json_rpc_error(id, -32601, format!("method not found: {method}")),
        }
    }

    fn handle_initialize(&self, id: Value, scope: McpScope) -> Value {
        let name = match scope {
            McpScope::Self_ => "timer_self",
            McpScope::Manager => "timer_manager",
        };
        json_rpc_ok(
            id,
            json!({
                "protocolVersion": "2025-03-26",
                "serverInfo": { "name": name, "version": "0.1.0" },
                "capabilities": { "tools": { "listChanged": false } }
            }),
        )
    }

    fn handle_tools_list(&self, id: Value, scope: McpScope) -> Value {
        let tools = match scope {
            McpScope::Self_ => self_tools(),
            McpScope::Manager => manager_tools(),
        };
        json_rpc_ok(id, json!({ "tools": tools }))
    }

    async fn handle_tools_call(
        &self,
        id: Value,
        scope: McpScope,
        runtime_id: &str,
        params: Value,
    ) -> Value {
        let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let args = params
            .get("arguments")
            .cloned()
            .unwrap_or(json!({}));

        match self.call_tool(scope, runtime_id, name, args).await {
            Ok(result) => json_rpc_ok(id, mcp_text_result(result)),
            Err(e) => json_rpc_error(id, -32602, e.to_string()),
        }
    }

    async fn call_tool(
        &self,
        scope: McpScope,
        runtime_id: &str,
        name: &str,
        args: Value,
    ) -> Result<Value> {
        match name {
            "CreateOneShotTimer" => {
                let normalized = normalize_create_args(scope, runtime_id, &args)?;
                let timer = self
                    .store
                    .create_one_shot_timer(
                        &normalized.runtime_id,
                        &normalized.session_id,
                        &normalized.executor_runtime_id,
                        &normalized.executor_session_id,
                        &normalized.title,
                        &normalized.msg,
                        normalized.after_seconds,
                    )
                    .await?;
                Ok(json!({
                    "ok": true,
                    "timer_id": timer.timer_id,
                    "runtime_id": timer.runtime_id,
                    "session_id": timer.session_id,
                    "trigger_at": timer.trigger_at,
                    "timer_type": "one_shot",
                    "status": "pending"
                }))
            }
            "DeleteRuntimeTimer" => {
                let normalized = normalize_owner_args(scope, runtime_id, &args)?;
                let timer_id = require_text(&args, "timerID")?;
                let deleted = self
                    .store
                    .delete_timer(&timer_id, &normalized.runtime_id, &normalized.session_id)
                    .await?;
                Ok(json!({ "ok": true, "deleted": deleted, "timer_id": timer_id }))
            }
            "ListRuntimeTimers" => {
                let normalized = normalize_owner_args(scope, runtime_id, &args)?;
                let list = self
                    .store
                    .list_timers(&normalized.runtime_id, &normalized.session_id)
                    .await;
                Ok(json!({ "realsize": list.len(), "list": list }))
            }
            "ListAllTimers" => {
                // Manager-only
                if scope != McpScope::Manager {
                    bail!("ListAllTimers is only available in manager scope");
                }
                let _executor = normalize_executor(&args)?;
                let list = self.store.list_all_timers().await;
                Ok(json!({ "realsize": list.len(), "list": list }))
            }
            "CreatePeriodicTimer" | "CreateCronTimer" => {
                bail!("{name} is not supported in this version; use CreateOneShotTimer")
            }
            "ReloadConfig" => bail!("ReloadConfig is not available in this context"),
            _ => bail!("unknown tool: {name}"),
        }
    }
}

// ── Argument normalization ───────────────────────────────────────────

struct NormalizedCreate {
    runtime_id: String,
    session_id: String,
    executor_runtime_id: String,
    executor_session_id: String,
    title: String,
    msg: String,
    after_seconds: u64,
}

struct NormalizedOwner {
    runtime_id: String,
    session_id: String,
}

struct ExecutorInfo {
    executor_runtime_id: String,
    executor_session_id: String,
}

fn normalize_executor(args: &Value) -> Result<ExecutorInfo> {
    Ok(ExecutorInfo {
        executor_runtime_id: args
            .get("ExecutorRuntimeID")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        executor_session_id: require_text(args, "ExecutorSessionID")?,
    })
}

fn normalize_create_args(
    scope: McpScope,
    runtime_id: &str,
    args: &Value,
) -> Result<NormalizedCreate> {
    let executor = normalize_executor(args)?;
    let (rt, ses) = match scope {
        McpScope::Self_ => (
            runtime_id.to_string(),
            executor.executor_session_id.clone(),
        ),
        McpScope::Manager => (
            require_text(args, "runtimeID")?,
            require_text(args, "sessionID")?,
        ),
    };
    let after_seconds = args
        .get("afterSeconds")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| anyhow::anyhow!("afterSeconds is required and must be a positive integer"))?;

    Ok(NormalizedCreate {
        runtime_id: rt,
        session_id: ses,
        executor_runtime_id: executor.executor_runtime_id,
        executor_session_id: executor.executor_session_id,
        title: args
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        msg: require_text(args, "msg")?,
        after_seconds,
    })
}

fn normalize_owner_args(
    scope: McpScope,
    runtime_id: &str,
    args: &Value,
) -> Result<NormalizedOwner> {
    let executor = normalize_executor(args)?;
    let (rt, ses) = match scope {
        McpScope::Self_ => (
            runtime_id.to_string(),
            executor.executor_session_id.clone(),
        ),
        McpScope::Manager => (
            require_text(args, "runtimeID")?,
            require_text(args, "sessionID")?,
        ),
    };
    Ok(NormalizedOwner {
        runtime_id: rt,
        session_id: ses,
    })
}

fn require_text(args: &Value, key: &str) -> Result<String> {
    let val = args
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if val.is_empty() {
        bail!("{key} is required");
    }
    Ok(val)
}

// ── Tool schemas ────────────────────────────────────────────────────

fn self_tools() -> Value {
    json!([
        tool_def(
            "CreateOneShotTimer",
            "Create a one-shot timer that fires after the specified delay",
            json!({
                "type": "object",
                "properties": {
                    "ExecutorRuntimeID": { "type": "string", "description": "Optional caller runtimeID for audit" },
                    "ExecutorSessionID": { "type": "string", "description": "Caller sessionID (owner of the timer)" },
                    "title": { "type": "string", "description": "Optional timer title" },
                    "msg": { "type": "string", "description": "Timer message delivered when fired" },
                    "afterSeconds": { "type": "integer", "description": "Seconds until timer fires" }
                },
                "required": ["ExecutorSessionID", "msg", "afterSeconds"],
                "additionalProperties": false
            })
        ),
        tool_def(
            "DeleteRuntimeTimer",
            "Delete a pending timer by ID",
            json!({
                "type": "object",
                "properties": {
                    "ExecutorRuntimeID": { "type": "string" },
                    "ExecutorSessionID": { "type": "string" },
                    "timerID": { "type": "string", "description": "Timer ID to delete" }
                },
                "required": ["ExecutorSessionID", "timerID"],
                "additionalProperties": false
            })
        ),
        tool_def(
            "ListRuntimeTimers",
            "List timers for the current runtime/session",
            json!({
                "type": "object",
                "properties": {
                    "ExecutorRuntimeID": { "type": "string" },
                    "ExecutorSessionID": { "type": "string" }
                },
                "required": ["ExecutorSessionID"],
                "additionalProperties": false
            })
        ),
    ])
}

fn manager_tools() -> Value {
    let mut tools = self_tools();
    let arr = tools.as_array_mut().unwrap();
    arr.push(tool_def(
        "ListAllTimers",
        "List all timers across all runtimes/sessions (manager only)",
        json!({
            "type": "object",
            "properties": {
                "ExecutorRuntimeID": { "type": "string" },
                "ExecutorSessionID": { "type": "string" }
            },
            "required": ["ExecutorSessionID"],
            "additionalProperties": false
        }),
    ));
    // Manager variants of create/delete/list with explicit runtimeID/sessionID
    arr.push(tool_def(
        "CreateOneShotTimer",
        "Create a one-shot timer for a specific runtime/session (manager)",
        json!({
            "type": "object",
            "properties": {
                "ExecutorRuntimeID": { "type": "string" },
                "ExecutorSessionID": { "type": "string" },
                "runtimeID": { "type": "string", "description": "Target runtimeID" },
                "sessionID": { "type": "string", "description": "Target sessionID" },
                "title": { "type": "string" },
                "msg": { "type": "string" },
                "afterSeconds": { "type": "integer" }
            },
            "required": ["ExecutorSessionID", "runtimeID", "sessionID", "msg", "afterSeconds"],
            "additionalProperties": false
        }),
    ));
    tools
}

fn tool_def(name: &str, description: &str, input_schema: Value) -> Value {
    json!({
        "name": name,
        "description": description,
        "inputSchema": input_schema
    })
}

// ── JSON-RPC helpers ────────────────────────────────────────────────

fn json_rpc_ok(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn json_rpc_error(id: Value, code: i64, message: String) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn mcp_text_result(data: Value) -> Value {
    json!({ "content": [{ "type": "text", "text": serde_json::to_string_pretty(&data).unwrap_or_default() }] })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn self_request(method: &str, params: Value) -> Value {
        json!({ "id": 1, "method": method, "params": params })
    }

    #[tokio::test]
    async fn test_initialize_self() {
        let api = McpApi::new(TimerStore::new());
        let resp = api
            .handle_request(McpScope::Self_, "test-rt", self_request("initialize", json!({})))
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
            .handle_request(McpScope::Self_, "test-rt", self_request("tools/list", json!({})))
            .await;
        let tools = resp["result"]["tools"].as_array().unwrap();
        assert!(tools.iter().any(|t| t["name"] == "CreateOneShotTimer"));
        assert!(tools.iter().any(|t| t["name"] == "ListRuntimeTimers"));
        // Self scope should NOT have ListAllTimers
        assert!(!tools.iter().any(|t| t["name"] == "ListAllTimers"));
    }

    #[tokio::test]
    async fn test_tools_list_manager() {
        let api = McpApi::new(TimerStore::new());
        let resp = api
            .handle_request(
                McpScope::Manager,
                "test-rt",
                self_request("tools/list", json!({})),
            )
            .await;
        let tools = resp["result"]["tools"].as_array().unwrap();
        assert!(tools.iter().any(|t| t["name"] == "ListAllTimers"));
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
    async fn test_create_and_list_and_delete() {
        let api = McpApi::new(TimerStore::new());

        // Create
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

        // List
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

        // Delete
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

        // List again — should be empty
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

        // Create in self scope
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

        // ListAll in manager scope
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
}
