# OSG MCP Endpoints and Tools

## Overview

The current OSG server exposes three MCP-style HTTP endpoints under `/api/v2/mcp/`:

- `/api/v2/mcp/runtime_control`
- `/api/v2/mcp/session_bridge`
- `/api/v2/mcp/timer_scheduler`
- `/api/v2/mcp/timer_manager`

These endpoints accept JSON-RPC-shaped requests and return JSON-RPC responses.
The tool-call pattern currently used is:

1. `initialize`
2. optional `notifications/initialized`
3. `tools/list`
4. `tools/call`

## Common RPC Shape

Successful responses are returned as:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { ... }
}
```

Errors are returned as:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32602,
    "message": "..."
  }
}
```

Tool results are generally wrapped as a text payload whose content is JSON stringified.
That means integrations often need to parse `result.content[0].text` as JSON.

## runtime_control

### Purpose

The `runtime_control` endpoint is the control/discovery surface for runtimes, sessions, InstanceWorkspaces, and model-related actions.

### Implemented Tools

Current tool list in code:

- `ListClients`
- `ListClientSessions`
- `CreateNewSession`
- `AddPrompt`
- `SpawnSession`
- `RenameClientSession`
- `SetClientDisplaySession`
- `AbortClientSession`
- `ListAvailableModels`
- `GetSessionLastUsedModel`
- `ListClientInstanceWorkspaces`
- `ReloadClientInstanceWorkspace`

### Behavior Notes

- `initialize` does not appear to require a specific runtime binding.
- This endpoint behaves more like a global control plane.
- It is suitable for discovery and administrative actions.
- `AddPrompt` is now exposed here as a direct control tool for sending a user message into a targeted live runtime/session, with optional per-turn `system` info.

### AddPrompt Semantics

The MCP tool name is `AddPrompt`, while the protocol path still uses the historical identifier `AddPromot`.

Current request shape:

```json
{
  "runtimeID": "...",
  "sessionID": "...",
  "msg": "user message",
  "model": "provider/model",
  "system": "optional per-turn system info"
}
```

Current meaning:

- `msg` is always the user message for that turn,
- `system` is optional extra system context for that turn,
- `role` is no longer the intended control surface for arbitrary message injection.

Migration note:

- old role-based usage like `role: "system"` should move to `system`,
- old role-based usage like `role: "tool"` should not be treated as supported `AddPrompt` behavior anymore,
- integrations should treat `AddPrompt` as session input, not a generic arbitrary-role message writer.

## session_bridge

### Purpose

The `session_bridge` endpoint is the runtime-bound bridge for interacting with live sessions and mailbox-like session communication.

### Implemented Tools

Current tool list in code:

- `ListLivingSessions`
- `GetSessionMessages`
- `ListMailboxItems`
- `ReplyMailboxItem`
- `SendMailboxItem`
- `ReadMailboxItem`

### Runtime Binding Requirement

Unlike `runtime_control`, `session_bridge` requires a runtime binding.
A runtime must be resolved by passing `runtimeID` in the request query string.

The endpoint validates that the selected runtime is online.
If the runtime is missing or offline, the request is rejected.

### Behavior Notes

This endpoint is effectively the live interaction plane for session content and mailbox workflows.
It is used by the Feishu bridge to:

- fetch recent session messages.
- mailbox tools that operate on the current executor session now use `ExecutorSessionID` instead of guessing sender/session context from caller identity.

## timer_scheduler

### Purpose

The `timer_scheduler` endpoint is the self-bucket timer surface for scheduling deferred prompts into the current executor session bucket.

### Implemented Tools

Current tool list in code:

- `CreateOneShotTimer`
- `CreatePeriodicTimer`
- `CreateCronTimer`
- `DeleteRuntimeTimer`
- `ListRuntimeTimers`

### Behavior Notes

- `timer_scheduler` resolves the runtime from the MCP handshake query and the session from `ExecutorSessionID`.
- This surface is limited to the caller's current timer bucket.
- `CreatePeriodicTimer` repeats every `everySeconds`.
- `CreateCronTimer` uses a 5-field UTC cron expression: `minute hour day month weekday`.
- When a timer fires, the plugin sends `msg: "[OSG-Timer-Triggered]"` with timer metadata in the per-turn `system` field.
- One-shot timers are deleted after success; periodic and cron timers advance `triggerAt` to the next occurrence.
- If the target runtime/session is unavailable when firing, the timer moves to `waiting_runtime` and retries later.

## timer_manager

### Purpose

The `timer_manager` endpoint is the manager surface for inspecting and managing timers across all runtime/session buckets.

### Implemented Tools

Current tool list in code:

- `CreateOneShotTimer`
- `CreatePeriodicTimer`
- `CreateCronTimer`
- `DeleteRuntimeTimer`
- `ListRuntimeTimers`
- `ListAllTimers`

### Behavior Notes

- `timer_manager` takes explicit `runtimeID` + `sessionID` target arguments.
- `ListAllTimers` returns timers across all buckets owned by the plugin.
- Timers are stored per `runtimeID` + `sessionID`, not per InstanceWorkspace.

## Important Design Distinction

The current implementation suggests a deliberate separation:

- `runtime_control` = discovery / control / management plane
- `session_bridge` = live session interaction plane for session messages and mailbox workflows

This distinction is important and should remain explicit in future docs and integrations.

## Naming Note

The protocol library still contains a historical identifier named `AddPromot`, but the MCP tool exposed by `runtime_control` is `AddPrompt`.
This should be documented carefully to avoid confusion when mapping protocol objects to MCP tool names and when describing the narrowed user-message semantics.
