# OSG Concepts and Terms

## Runtime

A runtime is the top-level live identity in OSG.
It is keyed by `runtimeID` and owns the active WS bridge state plus cached session, instance-workspace, and display bundles for that runtime.

## Session

A session is the active execution or conversation unit inside one runtime.
Session bundles are keyed by `runtimeID::sessionID` and currently track `displayID`, `title`, `status`, `lastActiveTime`, and `activeCount`.

## Instance workspace

An instance workspace is the runtime-side working directory reported by client activity.
The registry key is `runtimeID::instanceWorkspaceDirectory`, not `runtimeID::workspaceID`.

Current bundles store:

- `instanceWorkspaceDirectory`
- `title`
- MCP caller-binding state

## Display

A display is the runtime-side UI slot identified by `displayID`.
Session rows can point at a display, and display bundles are tracked separately from session bundles.

## MCP surface

An MCP surface is a plugin-provided JSON-RPC HTTP interface served under `/api/v2/mcp/[surface]`.
Current built-in plugin surfaces include `runtime_control`, `session_bridge`, `timer_scheduler`, and `timer_manager`, with IM gateway surfaces appearing when that plugin is loaded.

## Queue

A queue is the runtime-specific in-memory WS state object for one connected client.
It tracks:

- pending WS request promises
- remembered recent events
- `lastClientContentExecuteing`
- `lastSessionList`
- connection and activity timestamps

## Permission

A permission record is the server-side live record created from runtime permission events.
Permissions are tracked in memory and exposed through `runtime_control` tools.

## Connected ack

A connected acknowledgment is the server WS envelope sent after a runtime has been accepted by the gateway.
The reusable client library treats this ack as the real readiness point.

## Protocol library

The protocol library is the shared contract package for WS envelopes, payload readers, and payload creators.
It defines names and shapes. It does not prove that every runtime or surface fully implements them.

## Naming caution

The current codebase still contains historical or inconsistent identifiers such as:

- `AddPromot`
- `ClientContentExecuteing`
- `protocol-library`

When documenting OSG, keep the real code names searchable and explain the intended meaning separately.
