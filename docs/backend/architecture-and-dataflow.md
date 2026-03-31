# OSG Architecture and Data Flow

## Core Architectural View

The current OSG architecture can be read as four layers:

1. **Protocol layer** — shared message contracts and event payloads.
2. **Runtime connection layer** — long-lived WebSocket connections between runtimes and the gateway.
3. **Gateway control layer** — HTTP MCP endpoints and server-side state coordination.
4. **Integration layer** — Feishu bridge, OpenCode plugin integration, and future client adapters.

## Main Entities

### Runtime

A runtime is the primary connected execution endpoint in OSG.
A runtime is identified by `runtimeID` and usually also carries `host_name` when connecting to the WebSocket endpoint.

The server keeps runtime-specific queue state, including:

- pending request/response tracking,
- recent events,
- last active timestamps,
- last known current info,
- last known session list,
- connection metadata.

### Session

A session is the working conversational or execution container inside a runtime.
Operations like adding prompts or fetching message history are session-targeted.

### Workspace

Workspace appears as a contextual grouping or directory-level environment associated with runtime execution state.
The server updates workspace/session associations based on runtime-originated events such as `ClientContentExecuteing`.

## WebSocket Runtime Flow

### Runtime Connect Flow

1. A runtime client constructs an OSG WebSocket URL.
2. The client appends `runtimeID` and `host_name` query parameters.
3. The client connects to `ws://<host>:4088/api/v2/wsport`.
4. The server creates or registers a queue for that runtime.
5. The connection is treated as fully established only after a `connected` acknowledgment is received.

This explicit acknowledgment matters because it separates transport-level connection success from OSG-level runtime registration success.

## Event Envelope Model

The shared envelope shape is effectively:

```json
{
  "type": "SomeEvent",
  "requestID": "req_xxx",
  "data": { ... }
}
```

Responses to events use an `event_response` shape carrying:

- `requestID`
- `ok`
- `data`

This enables request/response behavior over WebSocket while keeping event naming explicit.

## Server-Side Queue Behavior

For each connected runtime, the server keeps a queue-like state object that includes:

- the active WebSocket object,
- sequence-based request ID generation,
- pending response promises and timeouts,
- remembered recent events,
- summary state like `lastCurrentInfo` and `lastSessionList`.

This means the gateway is not acting as a stateless relay. It is maintaining a runtime-centric state cache and event coordination layer.

## HTTP MCP Layer

The server exposes HTTP endpoints under `/api/v2/mcp/...`.
Two categories are already visible in the repository:

- `runtime_control`
- `session_bridge`

At a conceptual level:

- `runtime_control` is for runtime/session discovery and control-oriented queries,
- `session_bridge` is for live session message retrieval and mailbox-style interaction.

The Feishu bridge currently uses these HTTP MCP endpoints rather than the raw runtime WebSocket channel.

## Feishu Bridge Data Flow

### Inbound Flow

1. Feishu sends a webhook event to the bridge.
2. The bridge parses the incoming text message.
3. The bridge checks local state to avoid duplicate processing.
4. The bridge resolves a mapping from Feishu `chatId` to `runtimeID + sessionID`.
5. The bridge calls OSG via HTTP MCP to send a user message to the mapped session, with optional per-turn system context.

### Outbound Flow

1. The bridge periodically polls OSG for session messages.
2. It fetches recent rows for the mapped runtime/session.
3. It filters for roles currently considered forwardable:
   - `assistant`
   - `tool`
   - `system`
4. It fingerprints message content to avoid duplicate sends.
5. It posts the resulting text back to Feishu.

Outbound forwarding still uses polling. That outbound role filtering is separate from inbound `AddPrompt` semantics, which now treat `msg` as the user message plus optional per-turn `system` context.

## Open Questions for Later Documentation

The current implementation already reveals the general architecture, but some areas still need deeper reading before documenting as settled behavior:

- exact MCP tool definitions and argument names,
- how runtime persistence is modeled beyond in-memory queue state,
- how workspace and session registries are initialized and reconciled,
- whether there are multiple intended runtime classes or transport variants.
