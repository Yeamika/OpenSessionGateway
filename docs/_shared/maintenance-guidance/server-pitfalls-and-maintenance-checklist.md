# OSG Server Pitfalls and Maintenance Checklist

## Why This Exists

OpenSessionGateway currently mixes protocol definitions, live runtime coordination, MCP control surfaces, and bridge integrations.
That makes local changes deceptively easy and architectural regressions deceptively likely.

This note captures the current maintenance traps that seem most important from code inspection.

## Major Pitfalls

### 1. Mistaking protocol presence for full implementation

Several protocol/event names and request handlers already exist, but not every client implementation appears equally complete.

Examples observed in current code:

- `AddPromot`
- `ListSession`
- `SetClientDisplaySession`
- `GetSessionMsg`
- `RequestCurrentInfo`

Maintenance risk:

- a maintainer sees a defined event or helper and assumes the whole path is production-ready,
- docs accidentally describe protocol capability as guaranteed behavior,
- bridge code is written against optimistic assumptions instead of verified runtime behavior.

Checklist:

- confirm whether the path is only defined in `protocol-library`,
- confirm whether `server/` actually routes it,
- confirm whether at least one real client implementation performs the expected behavior,
- document partial implementation explicitly.

### 2. Treating the server as a thin stateless gateway

The server is not just forwarding MCP calls and WebSocket packets.
It also owns live runtime/session/workspace interpretation through in-memory registries.

Maintenance risk:

- refactors break runtime/session/workspace reconstruction,
- UI and MCP tools drift apart from the live state model,
- restart/disconnect behavior is misunderstood.

Checklist:

- inspect `server/lib/ClientModel/` and `server/lib/runtime-hub.ts` before changing routing logic,
- check how a change affects `runtimeID`, `sessionID`, and `workspaceID` relationships,
- verify whether a state is durable, cached, or purely in-memory.

### 3. Confusing durable state with live derived state

Current inspection suggests a split across:

- PostgreSQL / Prisma metadata,
- Redis utility/shared runtime dependency,
- in-memory runtime/session/workspace/mailbox registries.

Maintenance risk:

- assuming restart safety where there is none,
- overpromising durability in docs,
- introducing bugs by writing to one layer while reading from another.

Checklist:

- ask whether the state must survive restart,
- locate actual write/read paths before calling a state "persistent",
- document restart behavior whenever touching live registries.

### 4. Underestimating mailbox behavior

Mailbox is not only a passive unread list.
Current code indicates mailbox reminders can synthesize prompt-like messages back into sessions.

Maintenance risk:

- breaking reminder behavior while "cleaning up notifications",
- misunderstanding mailbox as an external-only side channel,
- hiding a meaningful session injection path from documentation.

Checklist:

- inspect both mailbox storage and reminder scheduling,
- verify whether a change alters prompt injection behavior,
- document whether a mailbox path is read-only, reply-oriented, or prompt-injecting.

### 5. Flattening control plane and session interaction plane

The codebase currently separates at least two important MCP surfaces:

- `runtime_control`
- `session_bridge`

They should not be treated as interchangeable.

Maintenance risk:

- session-scoped operations get implemented as runtime-global controls,
- bridge packages bypass intended boundaries,
- tool semantics become inconsistent.

Checklist:

- identify whether an operation targets a runtime, a session, or a workspace,
- keep tool naming and docs aligned with the actual target scope,
- review both MCP route wiring and WS-side handling before changing semantics.

### 6. Ignoring disconnect and reconnect cleanup semantics

Current code shows runtime disconnect triggers queue cleanup and registry cleanup.
That means a disconnect is not just a transport blip; it can erase the server's live graph for that runtime.

Maintenance risk:

- reconnect behavior appears flaky even though cleanup is working as coded,
- maintainers assume stale state should still be queryable after disconnect,
- tests miss reconnection edge cases.

Checklist:

- inspect `cleanupQueue()` behavior before changing connection logic,
- test disconnect/reconnect scenarios explicitly,
- document what the server expects clients to resend after reconnect.

## Stable Maintenance Order

When touching OSG server behavior, reason in this order:

1. runtime/session/workspace domain model,
2. WS event flow,
3. MCP control surface,
4. bridge integration assumptions,
5. persistence/restart semantics,
6. UI/admin view consequences.

## Before Editing Server Behavior

Read first:

- `docs/01-project-overview.md`
- `docs/02-architecture-and-dataflow.md`
- `docs/05-mcp-endpoints-and-tools.md`
- `docs/06-runtime-session-workspace-model.md`
- `docs/07-persistence-and-mailbox-notes.md`
- `docs/08-server-maintenance-outline.md`

Then inspect code in:

- `server/server.ts`
- `server/lib/v2/ws/`
- `server/lib/v2/mcp/`
- `server/lib/ClientModel/`
- `server/lib/runtime-store.ts`
- bridge packages currently in use

## Documentation Rule of Thumb

When uncertain, document one of these explicitly instead of hand-waving:

- "implemented in protocol only"
- "implemented in server but not fully validated in real client"
- "current behavior inferred from code inspection"
- "restart behavior still unclear"

That is much better than pretending the system is more settled than it is.
