# OSG Server Pitfalls and Maintenance Checklist

## Why This Exists

OpenSessionGateway mixes protocol definitions, live runtime coordination, plugin-backed MCP surfaces, and integration plugins.
That makes local changes easy to ship and easy to misunderstand.

## Major Pitfalls

### 1. Mistaking protocol presence for end-to-end support

Some protocol names are defined in `protocol-library`, routed by `server/`, and implemented by real clients. Others are only partially validated.

Current high-value examples to check explicitly:

- `ClientContentExecuteing`
- `AddPromot` / MCP `AddPrompt`
- `CreateNewSession`
- `GetSessionMsg`
- `SetClientDisplaySession`
- `RequestRuntime`
- permission events and resolve flows

Checklist:

- confirm the protocol definition,
- confirm the server routing path,
- confirm at least one client implementation,
- document gaps instead of assuming success.

### 2. Treating the server as stateless

The server is not just forwarding MCP calls and WS packets.
It reconstructs live runtime, session, instance-workspace, display, and permission state in memory.

Checklist:

- inspect `server/lib/ClientModel/` and `server/lib/runtime-hub.ts` before changing routing,
- check how a change affects `runtimeID`, `sessionID`, `displayID`, and `instanceWorkspaceDirectory`,
- verify whether a state is durable, cached, or purely in memory.

### 3. Confusing live state with durable state

Current verified persistence looks like this:

- live runtime and session graph: in memory
- mailbox and timer state: plugin storage in memory
- permissions: in memory
- Redis: health and pager log paths
- Prisma client/schema: present, but not the current live runtime-state path

Checklist:

- locate the actual read and write path before calling a state persistent,
- document restart behavior whenever you touch live registries,
- do not imply DB-backed runtime state unless code proves it.

### 4. Underestimating mailbox behavior

Mailbox is not just an unread list.
The session-bridge plugin can schedule reminders that send `AddPrompt` messages into sessions and can also show a toast through a separate path.

Checklist:

- inspect both mailbox storage and reminder scheduling,
- verify whether a change alters prompt or toast behavior,
- document whether a mailbox path is read-only, reply-oriented, or prompt-injecting.

### 5. Treating MCP surfaces as static

The gateway serves MCP from `/api/v2/mcp/[surface]`, and the available surfaces depend on loaded plugins.

Current core surfaces include:

- `runtime_control`
- `session_bridge`
- `timer_scheduler`
- `timer_manager`

IM gateway surfaces appear only when that plugin is loaded.

Checklist:

- identify whether a surface is always autoloaded or optional,
- keep docs clear about dynamic availability,
- review plugin registration as well as route wiring.

### 6. Ignoring disconnect semantics

Runtime disconnect cleans the WS queue and marks the runtime offline, but it does not automatically delete cached runtime, session, instance-workspace, or display bundles.

Checklist:

- inspect `cleanupQueue()` before changing connection logic,
- test disconnect and reconnect flows explicitly,
- document what remains cached after disconnect and what disappears on full restart.

### 7. Forgetting server and web monitor drift

The server and `web/` currently use different monitor contracts.
Docs and UI changes need to verify both sides together.

Checklist:

- compare `server/lib/frontend/monitor-contract.ts` and `web/lib/monitor-contract.ts`,
- check field names and status enums,
- document current drift instead of assuming a shared schema.

## Stable Maintenance Order

When touching OSG server behavior, reason in this order:

1. runtime and session model,
2. WS event flow,
3. MCP surface behavior,
4. plugin integration assumptions,
5. persistence and restart semantics,
6. monitor and admin view consequences.

## Before Editing Server Behavior

Read first:

- `docs/backend/runtime-session-workspace-model.md`
- `docs/backend/architecture-and-dataflow.md`
- `docs/backend/mcp-endpoints-and-tools.md`
- `docs/backend/persistence-and-mailbox-notes.md`
- `docs/_shared/maintenance-guidance/server-maintenance-outline.md`

Then inspect code in:

- `server/server.ts`
- `server/app/api/v2/mcp/[surface]/route.ts`
- `server/lib/v2/ws/`
- `server/lib/ClientModel/`
- `server/lib/plugins/`
- `server/lib/runtime-store.ts`
- the integration plugins currently in use

## Documentation Rule of Thumb

When uncertain, document one of these explicitly instead of hand-waving:

- implemented in protocol only
- routed in server, but client validation still partial
- current behavior inferred from code inspection
- restart behavior still unclear

That is safer than pretending the system is more settled than it is.
