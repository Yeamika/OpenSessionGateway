# OpenSessionGateway Documentation Index

This directory contains maintainer-facing documentation for OpenSessionGateway (OSG).
The old numbered draft files were useful for initial code-reading notes, but they were hard to navigate once maintenance questions started splitting across backend, frontend, plugin, and cross-cutting concerns.

This structure is now maintainer-first.

## Recommended reading order

If you are new to OSG maintenance, read in this order:

1. [`_shared/project-overview.md`](./_shared/project-overview.md)
2. [`_shared/concepts-and-terms.md`](./_shared/concepts-and-terms.md)
3. [`backend/architecture-and-dataflow.md`](./backend/architecture-and-dataflow.md)
4. [`backend/mcp-endpoints-and-tools.md`](./backend/mcp-endpoints-and-tools.md)
5. [`backend/runtime-session-workspace-model.md`](./backend/runtime-session-workspace-model.md)
6. [`backend/persistence-and-mailbox-notes.md`](./backend/persistence-and-mailbox-notes.md)
7. [`_shared/maintenance-guidance/server-pitfalls-and-maintenance-checklist.md`](./_shared/maintenance-guidance/server-pitfalls-and-maintenance-checklist.md)

If the task is specifically about plugin/client integration boundaries, then also read:

8. [`plugins/opencode-plugin-side.md`](./plugins/opencode-plugin-side.md)
9. [`plugins/modified-opencode-side.md`](./plugins/modified-opencode-side.md)

## Directory structure

### `_shared/`
Cross-cutting docs that apply to the whole OSG system.

- [`project-overview.md`](./_shared/project-overview.md)
- [`concepts-and-terms.md`](./_shared/concepts-and-terms.md)
- [`current-observations-and-risks.md`](./_shared/current-observations-and-risks.md)
- [`maintenance-guidance/server-maintenance-outline.md`](./_shared/maintenance-guidance/server-maintenance-outline.md)
- [`maintenance-guidance/server-pitfalls-and-maintenance-checklist.md`](./_shared/maintenance-guidance/server-pitfalls-and-maintenance-checklist.md)
- [`maintenance-guidance/protocol-vs-server-vs-client-status.md`](./_shared/maintenance-guidance/protocol-vs-server-vs-client-status.md)

### `backend/`
Server backend behavior, routing, state model, and persistence boundaries.

- [`architecture-and-dataflow.md`](./backend/architecture-and-dataflow.md)
- [`mcp-endpoints-and-tools.md`](./backend/mcp-endpoints-and-tools.md)
- [`runtime-session-workspace-model.md`](./backend/runtime-session-workspace-model.md)
- [`persistence-and-mailbox-notes.md`](./backend/persistence-and-mailbox-notes.md)

### `frontend/`
Server frontend / admin UI notes.

- [`server-frontend.md`](./frontend/server-frontend.md)

### `plugins/`
Integration-side documentation, especially for OpenCode-facing runtime/plugin work.

- [`opencode-plugin-side.md`](./plugins/opencode-plugin-side.md)
- [`modified-opencode-side.md`](./plugins/modified-opencode-side.md)

## Major maintainer buckets

The documentation is intentionally organized around these questions:

1. **Server backend** — what the server actually owns, routes, stores, and forgets.
2. **Server frontend** — what the Next.js/UI layer is for, and what it should not be confused with.
3. **OpenCode plugin side** — how the OSG-facing plugin/runtime bridge is expected to connect and behave.
4. **Modified OpenCode side** — where a customized OpenCode runtime may or may not provide the protocol behaviors OSG expects.
5. **Cross-cutting pitfalls** — where protocol, server, client, persistence, and bridge assumptions commonly get mixed up.

## Documentation stance

These docs are still based on code reading and working maintenance inference, not on a frozen product spec.

So:

- describe current behavior first,
- call out uncertainty explicitly,
- separate protocol definition from server routing from real client evidence,
- prefer stable responsibilities and boundaries over fragile implementation trivia.
