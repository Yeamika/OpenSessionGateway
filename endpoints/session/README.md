# Session Endpoint

`endpoints/session` is the GlassVein session endpoint project. It is an
endpoint-side application, not a router role. One process provides:

- an HTTP API used by the browser and lightweight MCP-style JSON-RPC calls,
- a GV WebSocket endpoint client that connects to the router,
- static web assets for viewing session updates/messages and issuing actions.

## Boundaries

- Does not modify or depend on router internals beyond the public OSGP wire.
- Connects as `role: "endpoint"` and announces `surface_viewer` capability to
  receive `upload/session_update` fan-out.
- Sends session actions as canonical OSGP envelopes with `linkType` values
  `request` or `control`, canonical `subtype`, and explicit `source`/`target`.
- Handles `response` frames by their `source` and `target`; no legacy
  read-request/read-response API is used by this endpoint.

## Run

```bash
cargo run -p session-endpoint -- --listen 127.0.0.1:7310
```

Open <http://127.0.0.1:7310/>. Configure the router WebSocket URL, source
address, and target runtime/session, then click **Connect GV**.

## API

- `GET /api/state` returns connection/session state.
- `POST /api/connect` opens the GV WebSocket connection.
- `POST /api/disconnect` closes it.
- `POST /api/request` sends `runtime_session_view_snapshot` or
  `runtime_session_messages`.
- `POST /api/control` sends `add_prompt`, `abort_session`, `compact_session`,
  `create_session`, `rename_session`, or `resume_session`.
- `POST /mcp` accepts simple JSON-RPC method names: `initialize`, `tools/list`,
  and `tools/call` for the same API operations.

## Bridge and mailbox MCP tools

The former session-bridge/mailbox surface capabilities are merged here as
internal endpoint modules and exposed through `/mcp` `tools/call`:

- `ListLivingSessions`
- `GetSessionMessages`
- `ListMailboxItems` — newest items first
- `ReadMailboxItem`
- `SendMailboxItem`
- `ReplyMailboxItem`
- `DeleteMailboxItem`

Mailbox state is endpoint-local for this implementation. `DeleteMailboxItem`
returns `{ ok: false, message: "item not found" }` for a missing item.

Mailbox tools that operate on the caller's own mailbox require
`ExecutorSessionID` and optionally accept `ExecutorRuntimeID` when the host does
not inject caller runtime context. `sessionID` remains the target session for
`SendMailboxItem` only; it is not used as the caller mailbox identity.

## Test fake client

`tools/fake-client.mjs` is a test-only GV endpoint client. It declares a unique
runtime/session address, emits `upload/session_update`, and responds to
canonical request/control envelopes with `response` envelopes. It is not a
surface/project and should be run only for bounded smoke tests.

## Manual validation

```bash
cargo fmt --check -p session-endpoint
cargo check -p session-endpoint
find endpoints/session -type f -print0 | xargs -0 wc -l
rg -n 'surface(Id|_id)' endpoints/session
node --check endpoints/session/tools/fake-client.mjs
```

Expected: formatting/check pass, every file is under 500 lines, and the final
`rg` command returns no matches.
