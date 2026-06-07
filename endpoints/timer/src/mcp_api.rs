//! MCP JSON-RPC 2.0 API handlers.
//!
//! Supports `initialize`, `tools/list`, `tools/call` for both
//! self (`/mcp/timer_scheduler`) and manager (`/mcp/timer_manager`) scopes.

use anyhow::{bail, Result};
use serde_json::{json, Value};

use crate::timer_store::{CreateOneShotTimer, TimerStore};

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
    pub async fn handle_request(&self, scope: McpScope, runtime_id: &str, body: Value) -> Value {
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
            "tools/call" => self.handle_tools_call(id, scope, runtime_id, params).await,
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
        let args = params.get("arguments").cloned().unwrap_or(json!({}));

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
                    .create_one_shot_timer(CreateOneShotTimer {
                        runtime_id: &normalized.runtime_id,
                        session_id: &normalized.session_id,
                        executor_runtime_id: &normalized.executor_runtime_id,
                        executor_session_id: &normalized.executor_session_id,
                        title: &normalized.title,
                        msg: &normalized.msg,
                        after_seconds: normalized.after_seconds,
                    })
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
        // ExecutorSessionID is externally injected by the MCP host/runtime.
        // The endpoint requires it as the first audit/ownership argument.
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
        McpScope::Self_ => {
            // For self-scope: caller's runtime comes from ExecutorRuntimeID arg
            // (if provided), otherwise from the query parameter. Session always
            // comes from ExecutorSessionID (the caller's session).
            let caller_rt = if !executor.executor_runtime_id.is_empty() {
                executor.executor_runtime_id.clone()
            } else {
                runtime_id.to_string()
            };
            (caller_rt, executor.executor_session_id.clone())
        }
        McpScope::Manager => (
            require_text(args, "runtimeID")?,
            require_text(args, "sessionID")?,
        ),
    };
    let after_seconds = args
        .get("afterSeconds")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| {
            anyhow::anyhow!("afterSeconds is required and must be a positive integer")
        })?;

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
        McpScope::Self_ => {
            let caller_rt = if !executor.executor_runtime_id.is_empty() {
                executor.executor_runtime_id.clone()
            } else {
                runtime_id.to_string()
            };
            (caller_rt, executor.executor_session_id.clone())
        }
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
    let executor_runtime = json!({
        "type": "string",
        "description": "Optional externally injected caller runtimeID for audit"
    });
    let executor_session = json!({
        "type": "string",
        "description": "Externally injected caller sessionID; first required argument for audit and timer ownership"
    });

    json!([
        tool_def(
            "CreateOneShotTimer",
            "Create a one-shot timer that fires after the specified delay",
            json!({
                "type": "object",
                "properties": {
                    "ExecutorRuntimeID": executor_runtime,
                    "ExecutorSessionID": executor_session,
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
                    "ExecutorRuntimeID": executor_runtime,
                    "ExecutorSessionID": executor_session,
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
                    "ExecutorRuntimeID": executor_runtime,
                    "ExecutorSessionID": executor_session
                },
                "required": ["ExecutorSessionID"],
                "additionalProperties": false
            })
        ),
    ])
}

fn manager_tools() -> Value {
    json!([
        manager_tool_def(
            "CreateOneShotTimer",
            "Create a one-shot timer for a specific runtime/session",
            json!({
                "title": { "type": "string", "description": "Optional timer title" },
                "msg": { "type": "string", "description": "Timer message delivered when fired" },
                "afterSeconds": { "type": "integer", "description": "Seconds until timer fires" }
            }),
            json!(["msg", "afterSeconds"])
        ),
        manager_tool_def(
            "DeleteRuntimeTimer",
            "Delete a pending timer by ID for a specific runtime/session",
            json!({
                "timerID": { "type": "string", "description": "Timer ID to delete" }
            }),
            json!(["timerID"])
        ),
        manager_tool_def(
            "ListRuntimeTimers",
            "List timers for a specific runtime/session",
            json!({}),
            json!([])
        ),
        tool_def(
            "ListAllTimers",
            "List all timers across all runtimes/sessions",
            manager_executor_schema()
        )
    ])
}

fn tool_def(name: &str, description: &str, input_schema: Value) -> Value {
    json!({
        "name": name,
        "description": description,
        "inputSchema": input_schema
    })
}

fn manager_tool_def(
    name: &str,
    description: &str,
    extra_properties: Value,
    extra_required: Value,
) -> Value {
    let mut schema = manager_executor_schema();
    let properties = schema
        .get_mut("properties")
        .and_then(Value::as_object_mut)
        .expect("manager schema properties");
    properties.insert(
        "runtimeID".to_string(),
        json!({ "type": "string", "description": "Target runtimeID" }),
    );
    properties.insert(
        "sessionID".to_string(),
        json!({ "type": "string", "description": "Target sessionID; distinct from injected ExecutorSessionID" }),
    );
    if let Some(extra) = extra_properties.as_object() {
        for (key, value) in extra {
            properties.insert(key.clone(), value.clone());
        }
    }

    let required = schema
        .get_mut("required")
        .and_then(Value::as_array_mut)
        .expect("manager schema required");
    required.push(json!("runtimeID"));
    required.push(json!("sessionID"));
    if let Some(extra) = extra_required.as_array() {
        required.extend(extra.iter().cloned());
    }

    tool_def(name, description, schema)
}

fn manager_executor_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "ExecutorRuntimeID": {
                "type": "string",
                "description": "Optional externally injected caller runtimeID for audit"
            },
            "ExecutorSessionID": {
                "type": "string",
                "description": "Externally injected caller sessionID; first required argument for audit"
            }
        },
        "required": ["ExecutorSessionID"],
        "additionalProperties": false
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
mod tests;
