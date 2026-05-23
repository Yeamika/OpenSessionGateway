# @opensessiongateway/osgp

OSGP protocol types, builders, and codec for TypeScript.

## What this package is

`@opensessiongateway/osgp` is a **pure protocol library** for the OSGP (Open Session Gateway Protocol) wire format used by GlassVein routers. It provides TypeScript type definitions and lightweight helper functions for:

- Building and parsing OSGP wire frames (JSON over WebSocket text frames)
- Hello handshake messages
- Envelope construction with canonical `linkType` / `subtype` fields

**What it is not:**

- Not a WebSocket transport. Use the standard `WebSocket` API (Node ≥ 22, browser, Deno, Bun) or any WS library you prefer.
- Not a router. Router server runtime is a Rust/Pingora concern; this package only covers the endpoint/client side of the protocol.
- Not tied to any specific framework or runtime.

## Wire format overview

Every OSGP frame is a single JSON text message sent over a WebSocket connection. There are two categories of frames:

### 1. Hello (connection handshake)

The **first** message on any new WebSocket connection must be a `HelloMessage`. After the router processes Hello, it sends back its own Hello reply.

```json
{
  "nodeId": "my-endpoint",
  "role": "endpoint",
  "addresses": [{ "domain": "app", "runtime": "rt-1" }],
  "capabilities": ["surface_viewer"]
}
```

- `role`: `"endpoint"` (for clients/surfaces) or `"router"` (for inter-router links).
- `addresses`: session addresses this node can be reached at.
- `capabilities`: optional string array; known values include `"surface_viewer"`.

### 2. Envelope (data frames)

After Hello, all subsequent frames are OSGP `Envelope` objects:

```json
{
  "linkType": "upload",
  "subtype": "session_update",
  "source": { "address": { "domain": "app", "runtime": "rt-1" } },
  "messageId": "018f-a1b2-4000-8000-018fa1b2c3d4",
  "payload": { ... }
}
```

#### Canonical `linkType` / `subtype` values

| `linkType`  | Description                        | Has business `target`? |
|-------------|------------------------------------|------------------------|
| `upload`    | Fan-out data (session_update, requestion, etc.) | **No** — upload is broadcast to subscribers |
| `control`   | Commands (add_prompt, abort_session, etc.) | **Yes** — must include `target` |
| `request`   | Read/query operations              | **Yes** — must include `target` |
| `response`  | Reply to a request or control      | **Yes** — includes `messageId` for correlation |

Common `subtype` values:

| subtype                   | linkType   | Meaning                                  |
|---------------------------|------------|------------------------------------------|
| `session_update`          | `upload`   | Session state change notification        |
| `requestion_asked`        | `upload`   | Requestion entered "asked" state         |
| `requestion_resolved`     | `upload`   | Requestion resolved                      |
| `requestion_updated`      | `upload`   | Requestion state updated                 |
| `requestion_cancelled`    | `upload`   | Requestion cancelled                     |
| `add_prompt`              | `control`  | Add a prompt/message to a session        |
| `abort_session`           | `control`  | Abort a session                          |
| `compact_session`         | `control`  | Compact session context                  |
| `create_session`          | `control`  | Create a new session                     |
| `rename_session`          | `control`  | Rename a session                         |
| `requestion_respond`                      | `control`  | Respond to a requestion                          |
| `runtime_workspace_view_snapshot`         | `request`  | Read workspace tree or specific workspace info   |
| `runtime_requestion_snapshot`             | `request`  | Read pending requestions for a runtime           |
| `runtime_session_view_snapshot`           | `request`  | Read session state snapshot                      |
| `runtime_session_messages`                | `request`  | Read session message timeline                    |

## Usage examples

### Create a Hello message

```typescript
import { createHello } from "@opensessiongateway/osgp"

const hello = createHello({
  nodeId: "my-endpoint",
  role: "endpoint",
  addresses: [{ domain: "app", runtime: "rt-1" }],
  capabilities: ["surface_viewer"],
})
```

### Create an upload envelope (no business target)

```typescript
import { createUpload, type RouteTarget } from "@opensessiongateway/osgp"

const source: RouteTarget = { address: { domain: "app", runtime: "rt-1" } }

const upload = createUpload(
  "session_update",
  source,
  { sessionId: "ses-1", state: "running" },
)
```

### Create a control envelope (must have target)

```typescript
import { createControl, type RouteTarget } from "@opensessiongateway/osgp"

const source: RouteTarget = { address: { domain: "surface", runtime: "ctrl-rt" } }
const target: RouteTarget = { address: { domain: "app", runtime: "rt-1", session: "ses-1" } }

const control = createControl(
  "add_prompt",
  source,
  target,
  { text: "Hello from control surface", role: "user" },
  { ttl: 32 },
)
```

### Create a request envelope

```typescript
import { createRequest, type RouteTarget } from "@opensessiongateway/osgp"

const request = createRequest(
  "runtime_session_messages",
  source,
  target,
  { sessionId: "ses-1", limit: 20 },
  { ttl: 32 },
)
```

### Decode an incoming frame

```typescript
import { decodeOsgpFrame } from "@opensessiongateway/osgp"

ws.addEventListener("message", (event) => {
  const decoded = decodeOsgpFrame(event.data)

  if (decoded.kind === "envelope") {
    const env = decoded.value
    console.log(env.linkType, env.subtype, env.payload)
  } else if (decoded.kind === "hello") {
    console.log("hello:", decoded.value.nodeId)
  }
})
```

### Encode and send

```typescript
import { encodeOsgpFrame, createHello } from "@opensessiongateway/osgp"

const hello = createHello({ nodeId: "my-app", role: "endpoint" })
ws.send(encodeOsgpFrame(hello))
```

## Connection lifecycle

```
  Endpoint                        Router                        Runtime
    │                               │                              │
    │──── Hello ───────────────────>│                              │
    │<─── Hello reply ─────────────│                              │
    │                               │                              │
    │──── Envelope(upload) ────────>│  (session_update, etc.)      │
    │──── Envelope(control) ───────>│  (must include target)       │
    │──── Request(source=ep, ──────>│──── Request ────────────────>│
    │          target=rt/sess)      │                              │
    │                               │                              │
    │<─── Response(source=rt, ─────│<─── Response ────────────────│
    │          target=ep)           │       (target = req.source)  │
    │<─── Envelope(upload) ────────│  (fan-out)                   │
    │                               │                              │
```

> **Note**: ReadRequest uses `source` (reply-to address) and `target` (queried address).
> ReadResponse swaps them: `source` = responder, `target` = original requestor.
> `requestId` / `traceId` are for correlation only, not routing.
> There is no `surfaceId` wire field; routing is address-based via `source`/`target`.

## Relationship to other packages

```
osgp/rust                  — OSGP Rust crate (protocol types + serde)
osgp/ts                    — this package (protocol types + helpers)
examples/osgp-ts-endpoint/ — standalone example using these types
```

## Migration from legacy GlassVein wire format

Older GlassVein code used a flat `kind` field (e.g. `"kind": "add_prompt"`) or a `type` field with dotted subtypes. The OSGP format maps old kinds as follows:

| Old `kind` / `type`                  | New `linkType` | New `subtype`                     |
|--------------------------------------|----------------|-----------------------------------|
| `session_update`                     | `upload`       | `session_update`                  |
| `requestion.asked`                   | `upload`       | `requestion_asked`                |
| `requestion.resolved`                | `upload`       | `requestion_resolved`             |
| `add_prompt`                         | `control`      | `add_prompt`                      |
| `abort_session`                      | `control`      | `abort_session`                   |
| `control.command`                    | —              | **removed** (use `control` + subtype) |
| `opencode_event`                     | —              | **removed** (no wire emission)    |
| `list_workspaces`                    | `request`      | `runtime_workspace_view_snapshot` |
| `read_workspace_info`                | `request`      | `runtime_workspace_view_snapshot` |
| `list_session_messages`              | `request`      | `runtime_session_messages`        |
| `session_update_snapshot`            | `request`      | `runtime_session_view_snapshot`   |
| `requestion_snapshot`                | `request`      | `runtime_requestion_snapshot`     |
| `session_view_snapshot`              | `request`      | `runtime_session_view_snapshot`   |
| `session_update_subscribe`           | `request`      | `runtime_session_view_snapshot`   |

If you have existing TypeScript code using `SessionEnvelope` with a `kind` or `type` field, migrate to `OsgpEnvelope` with `linkType` and `subtype`.

## License

MIT
