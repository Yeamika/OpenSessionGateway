# OSG Architecture and Data Flow

## Core view

The current OSG implementation is easiest to read as four layers:

1. **Protocol layer**: shared WS contracts in `packages/protocol-library/`
2. **Runtime transport layer**: long-lived WS connections on `/api/v2/wsport`
3. **Gateway coordination layer**: in-memory runtime state plus plugin-backed MCP routing
4. **Integration layer**: OpenCode client integration, IM gateway, and the separate `web/` UI

## Runtime connect flow

1. A runtime client connects to `ws://<host>:4088/api/v2/wsport` with `runtimeID` and `host_name`.
2. The server rejects duplicate active `runtimeID` connections and cleans inactive old queues first.
3. The server creates the runtime queue, updates the runtime WS bridge, and emits `runtime_connect`.
4. The server sends the `connected` ack envelope.
5. Reusable clients treat that ack as the real readiness point.

## Queue behavior

Each connected runtime has one queue-like state object that keeps:

- pending response promises
- recent remembered events
- `lastActiveAt`
- `lastClientContentExecuteing`
- `lastSessionList`
- connection metadata such as `connectedAt`

The gateway is not a stateless relay. It keeps a runtime-scoped live cache and coordination layer.

## Live state learning

`ClientContentExecuteing` is the main source of live runtime activity.
It updates queue cache state and refreshes session, display, and instance-workspace bundles.

`ListSession` is also routed over WS, but its cached response is mainly a browseable session list. It is not the main source of session and workspace reconstruction.

## MCP layer

The server serves MCP through the dynamic route `/api/v2/mcp/[surface]`.

Important implications:

- surfaces are plugin-backed, not hardcoded route files
- `GET /api/v2/mcp/<surface>` returns the surface info payload
- `POST /api/v2/mcp/<surface>` handles JSON-RPC requests
- unknown surfaces return `404`

Current core surfaces include:

- `runtime_control`
- `session_bridge`
- `timer_scheduler`
- `timer_manager`

Additional surfaces such as `im_gateway_control` and `im_gateway_chat` appear only when that plugin is loaded.

## Integration flow

### OpenCode side

`packages/client-opencode-plugin-v2/` acts as a real OSG runtime client.
It reports activity back to the gateway and handles server-originated WS requests.

### IM gateway side

`plugins/IM-gateway/` handles inbound provider traffic, resolves a route and `sessionBindingID`, and calls `osg.addPrompt({ msg, system? })` for the bound OSG session.

Outbound IM replies do not come from polling OSG for session output anymore. They are sent through IM gateway chat tools such as `SendRouteTextMessage`, `RequestUpload`, and `SendRouteUpload`. Provider polling remains a provider sync and fallback path.

## Monitor flow

The gateway produces SSE from `/api/monitor/stream`.
`web/` rewrites `/api/*` to the gateway origin and consumes that stream from the browser.
