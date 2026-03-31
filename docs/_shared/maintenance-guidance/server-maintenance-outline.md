# OSG Server Maintenance Outline

## Why This Exists

OpenSessionGateway changes frequently. To keep maintenance work stable across many agents, do not treat the latest local implementation detail as the system definition. Start from the stable structural model of the server.

## Absolute Outline

When maintaining OSG, especially `OpenSessionGateway/server`, reason in this order:

1. **Server role**
   - The server is the runtime/session coordination hub.
   - It is not just a thin API wrapper, and it is not just a UI app.
   - It combines HTTP, WebSocket, MCP routing, and live runtime state coordination.

2. **Primary domain objects**
   - `runtime` is the root routing and connection identity.
   - `session` is the active conversation/execution unit under a runtime.
   - `workspace` is the execution/environment context associated with runtime activity.

3. **Communication layers**
   - WebSocket is the live runtime transport.
   - MCP HTTP endpoints are the external control and bridge interface.
   - Bridge packages (for example Feishu) adapt external systems into the runtime/session model.

4. **State layers**
   - In-memory registries hold much of the live runtime/session/workspace graph.
   - Database/Redis-backed layers are not interchangeable with those registries.
   - Do not assume a state is durable just because it exists in the server.

5. **Maintenance priority**
   - Preserve runtime/session/workspace boundaries.
   - Preserve the distinction between control-plane tools and live session interaction.
   - Preserve observability and debuggability of live state transitions.

## What To Read First

Before editing OSG server behavior, first read these docs if they exist:

- `OpenSessionGateway/docs/01-project-overview.md`
- `OpenSessionGateway/docs/02-architecture-and-dataflow.md`
- `OpenSessionGateway/docs/05-mcp-endpoints-and-tools.md`
- `OpenSessionGateway/docs/06-runtime-session-workspace-model.md`
- `OpenSessionGateway/docs/07-persistence-and-mailbox-notes.md`

Then inspect these code areas before making conclusions:

- `OpenSessionGateway/server/server.ts`
- `OpenSessionGateway/server/lib/v2/ws/`
- `OpenSessionGateway/server/lib/v2/mcp/`
- `OpenSessionGateway/server/lib/ClientModel/`
- `OpenSessionGateway/server/lib/runtime-*`

## Server-Centric Maintenance Rules

- Default to understanding `server/` first when asked about OSG behavior.
- Treat `runtimeID` as the root anchor for routing and live coordination.
- Do not discuss session behavior without checking how session state is attached to runtime and workspace state.
- Do not assume mailbox is just a passive inbox; it can inject reminder prompts back into sessions.
- Do not flatten `runtime_control` and `session_bridge` into one concept; they serve different planes.
- When frequent updates introduce noise, document the stable architectural role of a component before documenting its latest implementation details.
- Prefer adding or updating maintenance docs when structure becomes unclear, rather than relying on tribal memory.

## Naming Caution

Historical naming inconsistencies exist in OSG, including misspellings. Document them accurately, but do not let them distort the architectural model.

Examples already observed:

- `AddPromot`
- `ClientContentExecuteing`
- `protocol-library`

When writing docs or instructions for other agents:

- distinguish real code identifiers from corrected English descriptions,
- call out mismatches explicitly,
- avoid silently rewriting identifiers in a way that breaks code search.

## Expected Agent Behavior

If an agent is asked to maintain OSG:

1. Start from the docs and server structure.
2. Reconstruct the domain model before changing behavior.
3. Prefer structural understanding over local patching.
4. Update docs when a meaningful architectural understanding improves.
5. If implementation changes are frequent, keep the docs focused on stable responsibilities and boundaries.
