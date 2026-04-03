# Current Observations and Risks

## 1. Naming inconsistency still matters

Historical identifiers such as `AddPromot`, `ClientContentExecuteing`, and `protocol-library` are still active in code.
The main risk is documentation or migration notes silently using corrected English while code search still depends on the old names.

## 2. MCP surfaces are dynamic, not fixed

The gateway serves MCP through `/api/v2/mcp/[surface]`.
Surface availability depends on which plugins are currently autoloaded or loaded at runtime.

Docs should not imply that every surface is always present.

## 3. Live state is mostly in memory

Runtime, session, instance-workspace, display, permission, WS queue, and plugin-storage state is mostly process-local memory.
Disconnect keeps cached bundles and marks runtimes `offline`, while full server restart drops that live state.

Docs and operator notes need to distinguish:

- disconnect behavior,
- reconnect behavior,
- restart behavior.

## 4. Server and web monitor contracts currently drift

The gateway stream is produced from `server/lib/frontend/monitor-contract.ts`, but `web/` consumes a different contract in `web/lib/monitor-contract.ts`.
Current drift includes:

- server `instanceWorkspaceDirectory` vs web `workspace`
- server runtime status `online | offline` vs web `online | stale | offline`

Frontend docs should call this out instead of describing the contracts as already unified.

## 5. IM gateway routing depends on explicit bindings

Current IM gateway routing is built around routes and `sessionBindingID`, not around implicit default runtime or session guessing.
The main risk is stale, missing, or misconfigured bindings, especially when inbound provider traffic continues after runtime topology changes.

## 6. AddPrompt semantics are narrower now

`AddPrompt` now means: send a user message to one session, with optional `model` and per-turn `system` context.
Old role-based prompt injection assumptions should not keep leaking into new docs.

## 7. Documentation should follow current code paths

The highest-value maintenance habit is simple: describe current behavior first, then call out historical names or planned follow-up separately.
