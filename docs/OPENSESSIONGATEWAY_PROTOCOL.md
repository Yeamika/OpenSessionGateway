<!-- canonical: OSGP wire protocol specification -->
# OpenSessionGateway Protocol (OSGP)

OSGP is the WebSocket wire protocol used by GlassVein/OpenSessionGateway session routing.
The router side is a Pingora-based WebSocket router. Client and runtime processes are
ordinary WebSocket endpoints and may be implemented in any language.

This document defines the breaking, canonical business wire. It is not compatible with the
old `client` / `ObserverSurface` / `ControlSurface` / `kind` / `control.command` protocol.

## 1. Transport and handshake

- Transport: WebSocket text frames containing one JSON object per frame.
- Server/router role: Pingora-based router.
- Client role: any ordinary WebSocket endpoint.
- First client frame MUST be an OSGP Hello object, not a business envelope.
- Routers only understand network roles: `endpoint` and `router`.

### Hello

Required fields:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `nodeId` | string | yes | Stable id of this connection peer. |
| `role` | `"endpoint" | "router"` | yes | Network role only. No user-layer surface role. |
| `addresses` | `SessionAddress[]` | no, default `[]` | Routable addresses owned by this peer. |
| `capabilities` | string[] | no, default `[]` | Opaque weak tags. Router only uses `surface_viewer` for local upload fan-out. |

Example endpoint Hello:

```json
{
  "nodeId": "requestion-viewer-1",
  "role": "endpoint",
  "addresses": [
    { "domain": "domain-a", "runtime": "requestion-viewer", "session": "viewer" }
  ],
  "capabilities": ["surface_viewer"]
}
```

Example router Hello:

```json
{
  "nodeId": "east-router",
  "role": "router",
  "addresses": [],
  "capabilities": []
}
```

`SessionAddress` shape:

```json
{ "domain": "domain-a", "runtime": "runtime-alpha", "session": "session-alpha" }
```

`runtime` and `session` are optional for domain-level routes. Empty strings are invalid.

## 2. Canonical OSGP business envelope

After Hello, business frames use a single envelope shape. The only top-level business
`type` values are `upload`, `control`, `request`, and `response`.

```json
{
  "id": "01HW7JB4F3R1Y6YW6H3N4N3V9P",
  "type": "request",
  "subtype": "runtime_session_messages",
  "source": { "domain": "surface", "runtime": "control-ui", "session": "ui" },
  "target": { "domain": "domain-a", "runtime": "runtime-alpha", "session": "session-alpha" },
  "requestId": "req-01HW7JB4",
  "traceId": "trace-01HW7JB4",
  "ttl": 32,
  "payload": {}
}
```

Common fields:

| Field | Required | Applies to | Notes |
| --- | --- | --- | --- |
| `id` | yes | all | Unique message id. UUID/ULID recommended. |
| `type` | yes | all | One of `upload`, `control`, `request`, `response`. |
| `subtype` | yes | all | Business filter below `type`. |
| `source` | yes | all | Sender address. |
| `target` | yes except upload | control/request/response | Explicit route target. MUST be omitted or ignored for upload. |
| `requestId` | yes for request; yes for response to request | request/response | Correlates request/response. |
| `correlationId` | optional for control; required for response to control if no `requestId` | control/response | Correlates command/response. |
| `traceId` | recommended | all | Stable trace id across retries/hops. |
| `ttl` | optional default 32 | routed control/request/response | Router decrements or drops when exhausted. |
| `payload` | yes | all | Business data. Router does not parse for authorization. |
| `routeHops` | router-managed | all | Debug only; endpoints should not depend on it. |

## 3. Four link types and routing semantics

### `upload`

Upload is a local observation/event stream. It has no business target.

| Subtype | Meaning |
| --- | --- |
| `session_update` | Session state changed. |
| `requestion_asked` | A user-layer requestion was created. |
| `requestion_resolved` | A requestion was answered/resolved. |
| `requestion_updated` | A requestion changed while pending. |
| `requestion_cancelled` | A requestion was cancelled/expired. |

Routing: router MUST NOT use route-table target forwarding for `upload`. It MAY locally
fan out upload frames to connected endpoint peers whose Hello `capabilities` contains
`surface_viewer` (a capability tag, not a surface role). It MUST NOT forward upload to
router peers unless a future explicit subscription protocol is designed.

### `control`
Control is a targeted command from one endpoint to another endpoint or runtime.
| Subtype | Meaning |
| --- | --- |
| `add_prompt` | Add a prompt/message to a session. |
| `abort_session` | Abort a session. |
| `compact_session` | Compact/summarize a session. |
| `create_session` | Create a new session. |
| `rename_session` | Rename a session. |
| `resume_session` | Resume a session. |
| `requestion_respond` | Answer/reject a pending requestion. |

Routing: `target` is required and is resolved by endpoint route/address. Authorization and
command semantics belong to the target endpoint/user-layer service, not the router.

### `request`

Request is a targeted read/snapshot/query operation.

P-request subtypes are compressed to four canonical operations:

| Subtype | Meaning |
| --- | --- |
| `runtime_workspace_view_snapshot` | Workspace listing and info for a runtime. Supersedes `list_workspaces` and `read_workspace_info`. |
| `runtime_requestion_snapshot` | Runtime-wide requestion/question/permission snapshot. Supersedes `requestion_snapshot`. |
| `runtime_session_view_snapshot` | Combined session state + requestion + update snapshot. Supersedes `session_update_snapshot`, `session_view_snapshot`, and `session_update_subscribe`. |
| `runtime_session_messages` | Read recent messages of a session. Supersedes `list_session_messages`. |

Routing: `target` and `requestId` are required. Router forwards by `target` address only.
`requestId` is a correlation identifier — it is never used as a routing target.

### `response`

Response acknowledges or answers a `request` or `control`.

Rules:

- `type` MUST be `response`.
- `subtype` MUST equal the originating request/control subtype.
- Response MUST include `requestId` or `correlationId` for correlation.
- Response `target` MUST equal the originating request's `source` address.
  The router routes by `target` address; it does not inspect `requestId` for routing.
- `payload.status` SHOULD be `ok`, `error`, `not_found`, or `permission_denied`.
  Permission is reported by endpoint/user-layer services; router does not decide it.

## 4. True OSGP JSON examples

These examples are canonical OSGP business frames. They intentionally omit legacy
`kind`, `control.command`, `permission`, and `question` main-chain fields.

### Upload: `session_update`
```json
{
  "id": "upl-0001",
  "type": "upload",
  "subtype": "session_update",
  "source": { "domain": "domain-a", "runtime": "runtime-alpha", "session": "session-alpha" },
  "traceId": "trace-upl-0001",
  "payload": {
    "sessionId": "session-alpha",
    "state": "running",
    "title": "Investigate build failure",
    "summary": "Model is applying a patch",
    "metadata": { "model": "gpt-5.5", "agent": "Worker-GPT" }
  }
}
```

### Upload: `requestion_asked`

```json
{
  "id": "upl-0002",
  "type": "upload",
  "subtype": "requestion_asked",
  "source": { "domain": "domain-a", "runtime": "runtime-alpha", "session": "session-alpha" },
  "traceId": "trace-upl-0002",
  "payload": {
    "requestionId": "rq-42",
    "sessionId": "session-alpha",
    "title": "Approve file write?",
    "description": "The agent wants to update docs/OPENSESSIONGATEWAY_PROTOCOL.md",
    "choices": ["approve", "deny"],
    "blocking": true,
    "askedAt": "2026-05-16T00:00:00Z"
  }
}
```

### Upload: `requestion_resolved`

```json
{
  "id": "upl-0003",
  "type": "upload",
  "subtype": "requestion_resolved",
  "source": { "domain": "domain-a", "runtime": "runtime-alpha", "session": "session-alpha" },
  "traceId": "trace-upl-0003",
  "payload": {
    "requestionId": "rq-42",
    "sessionId": "session-alpha",
    "resolution": "approve",
    "resolvedBy": "control-ui",
    "resolvedAt": "2026-05-16T00:00:03Z"
  }
}
```

### Upload: `requestion_updated` and `requestion_cancelled`

```json
{
  "id": "upl-0004",
  "type": "upload",
  "subtype": "requestion_updated",
  "source": { "domain": "domain-a", "runtime": "runtime-alpha", "session": "session-alpha" },
  "traceId": "trace-upl-0004",
  "payload": { "requestionId": "rq-42", "status": "asked", "description": "Updated prompt text" }
}
```

```json
{
  "id": "upl-0005",
  "type": "upload",
  "subtype": "requestion_cancelled",
  "source": { "domain": "domain-a", "runtime": "runtime-alpha", "session": "session-alpha" },
  "traceId": "trace-upl-0005",
  "payload": { "requestionId": "rq-43", "reason": "session_closed" }
}
```

### Control examples

`add_prompt`:

```json
{
  "id": "ctl-0001",
  "type": "control",
  "subtype": "add_prompt",
  "source": { "domain": "surface", "runtime": "control-ui", "session": "ui" },
  "target": { "domain": "domain-a", "runtime": "runtime-alpha", "session": "session-alpha" },
  "correlationId": "corr-ctl-0001",
  "traceId": "trace-ctl-0001",
  "ttl": 32,
  "payload": { "text": "Please continue", "role": "user", "source": "control-ui" }
}
```

`abort_session`:

```json
{
  "id": "ctl-0002",
  "type": "control",
  "subtype": "abort_session",
  "source": { "domain": "surface", "runtime": "control-ui", "session": "ui" },
  "target": { "domain": "domain-a", "runtime": "runtime-alpha", "session": "session-alpha" },
  "correlationId": "corr-ctl-0002",
  "traceId": "trace-ctl-0002",
  "payload": { "reason": "user_cancelled" }
}
```

`compact_session`:

```json
{
  "id": "ctl-0003",
  "type": "control",
  "subtype": "compact_session",
  "source": { "domain": "surface", "runtime": "control-ui", "session": "ui" },
  "target": { "domain": "domain-a", "runtime": "runtime-alpha", "session": "session-alpha" },
  "correlationId": "corr-ctl-0003",
  "traceId": "trace-ctl-0003",
  "payload": { "auto": true }
}
```

`create_session`:

```json
{
  "id": "ctl-0004",
  "type": "control",
  "subtype": "create_session",
  "source": { "domain": "surface", "runtime": "control-ui", "session": "ui" },
  "target": { "domain": "domain-a", "runtime": "runtime-alpha" },
  "correlationId": "corr-ctl-0004",
  "traceId": "trace-ctl-0004",
  "payload": {
    "text": "Start a new task",
    "instanceWorkspaceDirectory": "/workspace/OSG-Project/GlassVein",
    "model": "gpt-5.5",
    "agent": "Worker-GPT"
  }
}
```

`rename_session`:

```json
{
  "id": "ctl-0005",
  "type": "control",
  "subtype": "rename_session",
  "source": { "domain": "surface", "runtime": "control-ui", "session": "ui" },
  "target": { "domain": "domain-a", "runtime": "runtime-alpha", "session": "session-alpha" },
  "correlationId": "corr-ctl-0005",
  "traceId": "trace-ctl-0005",
  "payload": { "title": "OSGP protocol convergence" }
}
```

`resume_session`:

```json
{
  "id": "ctl-0006",
  "type": "control",
  "subtype": "resume_session",
  "source": { "domain": "surface", "runtime": "control-ui", "session": "ui" },
  "target": { "domain": "domain-a", "runtime": "runtime-alpha", "session": "session-alpha" },
  "correlationId": "corr-ctl-0006",
  "traceId": "trace-ctl-0006",
  "payload": { "reason": "operator_requested" }
}
```

`requestion_respond`:

```json
{
  "id": "ctl-0007",
  "type": "control",
  "subtype": "requestion_respond",
  "source": { "domain": "surface", "runtime": "control-ui", "session": "ui" },
  "target": { "domain": "domain-a", "runtime": "runtime-alpha", "session": "session-alpha" },
  "correlationId": "corr-ctl-0007",
  "traceId": "trace-ctl-0007",
  "payload": {
    "requestionId": "rq-42",
    "replyType": "answer",
    "answers": [["approve"]],
    "reason": "operator approved"
  }
}
```

### Request examples

`runtime_workspace_view_snapshot`:

```json
{
  "id": "req-0001",
  "type": "request",
  "subtype": "runtime_workspace_view_snapshot",
  "source": { "domain": "surface", "runtime": "control-ui", "session": "ui" },
  "target": { "domain": "domain-a", "runtime": "runtime-alpha" },
  "requestId": "req-0001",
  "traceId": "trace-req-0001",
  "payload": { "includeSessions": true }
}
```

`runtime_requestion_snapshot`:

```json
{
  "id": "req-0002",
  "type": "request",
  "subtype": "runtime_requestion_snapshot",
  "source": { "domain": "surface", "runtime": "control-ui", "session": "ui" },
  "target": { "domain": "domain-a", "runtime": "runtime-alpha" },
  "requestId": "req-0002",
  "traceId": "trace-req-0002",
  "payload": { "runtimeId": "runtime-alpha", "sessionId": "session-alpha", "status": "asked", "blocking": true }
}
```

`runtime_session_view_snapshot`:

```json
{
  "id": "req-0003",
  "type": "request",
  "subtype": "runtime_session_view_snapshot",
  "source": { "domain": "surface", "runtime": "control-ui", "session": "ui" },
  "target": { "domain": "domain-a", "runtime": "runtime-alpha", "session": "session-alpha" },
  "requestId": "req-0003",
  "traceId": "trace-req-0003",
  "payload": { "sessionId": "session-alpha", "requestionStatus": "asked" }
}
```

`runtime_session_messages`:

```json
{
  "id": "req-0004",
  "type": "request",
  "subtype": "runtime_session_messages",
  "source": { "domain": "surface", "runtime": "control-ui", "session": "ui" },
  "target": { "domain": "domain-a", "runtime": "runtime-alpha", "session": "session-alpha" },
  "requestId": "req-0004",
  "traceId": "trace-req-0004",
  "payload": { "sessionId": "session-alpha", "limit": 50, "anchorTime": "2026-05-16T00:00:00Z" }
}
```

### Response examples

Response to `control/add_prompt`:

```json
{
  "id": "rsp-ctl-0001",
  "type": "response",
  "subtype": "add_prompt",
  "source": { "domain": "domain-a", "runtime": "runtime-alpha", "session": "session-alpha" },
  "target": { "domain": "surface", "runtime": "control-ui", "session": "ui" },
  "correlationId": "corr-ctl-0001",
  "traceId": "trace-ctl-0001",
  "payload": { "status": "ok", "accepted": true }
}
```

Response to `request/runtime_session_messages`:

```json
{
  "id": "rsp-req-0004",
  "type": "response",
  "subtype": "runtime_session_messages",
  "source": { "domain": "domain-a", "runtime": "runtime-alpha", "session": "session-alpha" },
  "target": { "domain": "surface", "runtime": "control-ui", "session": "ui" },
  "requestId": "req-0004",
  "traceId": "trace-req-0004",
  "payload": {
    "status": "ok",
    "messages": [
      { "id": "msg-1", "role": "user", "text": "Please continue", "createdAt": "2026-05-16T00:00:01Z" }
    ]
  }
}
```

Error response to any request/control keeps the same `subtype`:

```json
{
  "id": "rsp-err-0001",
  "type": "response",
  "subtype": "runtime_requestion_snapshot",
  "source": { "domain": "domain-a", "runtime": "runtime-alpha" },
  "target": { "domain": "surface", "runtime": "control-ui", "session": "ui" },
  "requestId": "req-0002",
  "traceId": "trace-req-0002",
  "payload": { "status": "not_found", "reason": "runtime not found" }
}
```

## 5. Removed and incompatible items

These are intentionally not part of OSGP:
- Network roles `client`, `ControlSurface`, `ObserverSurface`, `RequestionSurface`.
- Wire field `surfaceId` / `surface_id`. GV wire has no surface concept; endpoints are
  addressed by `source`/`target` (domain/runtime/session) and correlated by `requestId`.
  The Rust crate `surface` and endpoint package `surface-viewer` are SDK/application-layer
  names, not router roles or wire fields.
- Business dispatch by `kind`.
- `control.command` wrapper or nested main-chain command type.
- Independent `permission` / `question` top-level chains. Use requestion uploads and
  `requestion_respond` control instead.
- `list_runtime_question` / `list_runtime_permission` request subtypes. Use
  `runtime_requestion_snapshot`.
- Old request subtypes `list_workspaces`, `read_workspace_info`, `list_session_messages`,
  `session_update_snapshot`, `requestion_snapshot`, `session_view_snapshot`,
  `session_update_subscribe`. Replaced by the canonical P-request four:
  `runtime_workspace_view_snapshot`, `runtime_requestion_snapshot`,
  `runtime_session_view_snapshot`, `runtime_session_messages`.
- Upload route-table forwarding by target.
- Router-side user-layer authorization decisions.
