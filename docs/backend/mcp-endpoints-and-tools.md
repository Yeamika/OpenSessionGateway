# OSG MCP Endpoints and Tools

## Overview

The current gateway serves MCP through the dynamic route `/api/v2/mcp/[surface]`.
Surfaces are registered by plugins, so availability depends on which plugins are loaded.

Current core surfaces include:

- `runtime_control`
- `session_bridge`
- `timer_scheduler`
- `timer_manager`

Optional plugin surfaces such as `im_gateway_control` and `im_gateway_chat` appear only when those plugins are loaded.

## Common RPC flow

The current tool-call flow is:

1. `initialize`
2. optional `notifications/initialized`
3. `tools/list`
4. `tools/call`

`GET /api/v2/mcp/<surface>` returns the surface info payload.
`POST /api/v2/mcp/<surface>` handles JSON-RPC requests.
Unknown surfaces return `404`.

Tool results are usually wrapped as text content whose body is JSON stringified, so callers often need to parse `result.content[0].text`.

## `runtime_control`

### Purpose

`runtime_control` is the discovery and control surface for runtimes, sessions, instance workspaces, models, runtime probing, and runtime permissions.

### Implemented tools

- `ListRuntime`
- `ListClientDisplays`
- `ListActivedSessions`
- `ListClientInstanceWorkspaces`
- `ListRuntimeAvailableModels`
- `GetSessionLastUsedModel`
- `RequestRuntime`
- `CreateNewSession`
- `RenameClientSession`
- `SetClientDisplaySession`
- `AbortClientSession`
- `AddPrompt`
- `ReloadClientInstanceWorkspace`
- `ListRuntimePermissions`
- `GetRuntimePermission`
- `ResolveRuntimePermission`

### Behavior notes

- `initialize` does not require a specific runtime binding.
- This surface behaves like a global control plane.
- `AddPrompt` sends a user message into a targeted runtime and session, with optional per-turn `system` info.

### `AddPrompt` semantics

The MCP tool name is `AddPrompt`, while the WS protocol helper still uses the historical identifier `AddPromot`.

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

- `msg` is always the user message for that turn
- `system` is optional extra system context for that turn
- `role` is no longer the intended surface for arbitrary-role prompt injection

## `session_bridge`

### Purpose

`session_bridge` is the runtime-bound live session surface for message retrieval and mailbox workflows.

### Implemented tools

- `ListLivingSessions`
- `GetSessionMessages`
- `ListMailboxItems`
- `ReplyMailboxItem`
- `SendMailboxItem`
- `ReadMailboxItem`

### Runtime binding notes

- `initialize` accepts `runtimeID` from params or query.
- `tools/call` still requires `runtimeID` in the current request query.
- The surface checks that the selected runtime is online before serving tools.

Mailbox tools also use `ExecutorSessionID` for the current executor session bucket instead of guessing sender state from caller identity.

## `timer_scheduler`

### Purpose

`timer_scheduler` is the self-bucket timer surface for the current executor session bucket.

### Implemented tools

- `CreateOneShotTimer`
- `CreatePeriodicTimer`
- `CreateCronTimer`
- `DeleteRuntimeTimer`
- `ListRuntimeTimers`

### Behavior notes

- `tools/call` requires `runtimeID` in the request query.
- The target session is read from `ExecutorSessionID`.
- Timers fire by sending `msg: "[OSG-Timer-Triggered]"` with timer metadata in the per-turn `system` field.

## `timer_manager`

### Purpose

`timer_manager` is the manager surface for inspecting and managing timers across all runtime and session buckets owned by the plugin.

### Implemented tools

- `CreateOneShotTimer`
- `CreatePeriodicTimer`
- `CreateCronTimer`
- `DeleteRuntimeTimer`
- `ListRuntimeTimers`
- `ListAllTimers`

### Behavior notes

- Calls take explicit `runtimeID` and `sessionID` target arguments.
- Timers are stored per runtime and session bucket, not per instance workspace.

## Design distinction

The important split is still:

- `runtime_control` = discovery and management plane
- `session_bridge` = live session interaction and mailbox plane

Keep those responsibilities separate in docs and new tool design.
