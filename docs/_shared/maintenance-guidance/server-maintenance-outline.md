# OSG Server Maintenance Outline

## Why This Exists

OpenSessionGateway changes quickly. The safest way to maintain it is to start from the current structural model of the server instead of from one local feature path.

## Absolute Outline

When maintaining `server/`, reason in this order:

1. **Server role**
   - The server is the runtime and session coordination hub.
   - It combines HTTP, WebSocket runtime transport, plugin-backed MCP routing, monitor SSE, and local plugin admin.
   - It is not just a thin API wrapper and not the main interactive UI.

2. **Primary domain objects**
   - `runtime` is the root routing and connection identity.
   - `session` is the active execution unit under one runtime.
   - `instanceWorkspace` is the reported working directory context.
   - `display` is the runtime-side UI slot.
   - `permission` is a separate live state plane tied to runtime events.

3. **Communication layers**
   - WebSocket runtime transport: `/api/v2/wsport`
   - Plugin-backed MCP surfaces: `/api/v2/mcp/[surface]`
   - Monitor SSE: `/api/monitor/stream`
   - Separate web UI: `web/`

4. **State layers**
   - Live runtime, session, instance-workspace, display, permission, and queue state is mostly in memory.
   - Plugin storage is also process-local memory.
   - Redis is a current runtime dependency for health and pager log paths.
   - Prisma client and schema exist, but they are not the current live runtime-state source.

5. **Maintenance priority**
   - Preserve runtime and session boundaries.
   - Preserve the distinction between control-plane tools and live session interaction.
   - Preserve observability of connect, disconnect, activity, and permission transitions.

## What To Read First

Before editing OSG server behavior, read these docs first:

- `docs/README.md`
- `docs/backend/runtime-session-workspace-model.md`
- `docs/backend/architecture-and-dataflow.md`
- `docs/backend/mcp-endpoints-and-tools.md`
- `docs/backend/persistence-and-mailbox-notes.md`
- `server/docs/backend/runtime-session-workspace-model.md`
- `server/docs/backend/architecture-and-dataflow.md`
- `server/docs/backend/plugin-runtime-and-admin.md`

Then inspect these code areas:

- `server/server.ts`
- `server/app/api/v2/mcp/[surface]/route.ts`
- `server/app/api/monitor/stream/route.ts`
- `server/lib/v2/ws/`
- `server/lib/ClientModel/`
- `server/lib/plugins/`
- `server/lib/permission/`
- `server/lib/runtime-*`
- `web/lib/monitor-contract.ts`
- `server/lib/frontend/monitor-contract.ts`

## Server-Centric Maintenance Rules

- Default to understanding `server/` first when asked about OSG behavior.
- Treat `runtimeID` as the root anchor for routing and live coordination.
- Do not discuss session behavior without checking how activity is learned from `CLIENT_CONTENT_EXECUTEING`.
- Do not assume mailbox is just a passive inbox; reminder flow can send `AddPrompt` messages back into sessions.
- Do not flatten `runtime_control`, `session_bridge`, `timer_scheduler`, and `timer_manager` into one concept.
- Do not assume every MCP surface is always present; surfaces are plugin-loaded.
- Prefer updating docs when structure becomes unclear instead of relying on tribal memory.

## Naming Caution

Historical naming inconsistencies still exist in code:

- `AddPromot`
- `ClientContentExecuteing`
- `protocol-library`

Document the real identifiers accurately, then explain the intended meaning separately.

## Expected Agent Behavior

If an agent is asked to maintain OSG:

1. Start from the current docs and server structure.
2. Reconstruct the domain model before changing behavior.
3. Prefer structural understanding over local patching.
4. Update docs when the architectural understanding changes.
5. Keep docs focused on current responsibilities and boundaries when implementation details are moving fast.
