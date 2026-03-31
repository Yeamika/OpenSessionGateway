# OSG Server Frontend Notes

## Why this file exists

Most of the draft OSG docs were backend-heavy. That was reasonable, because the server-side routing and runtime model are the architectural core.
But maintainers also need one explicit note about the frontend/admin side so they do not accidentally treat the whole `server/` package as only a backend service.

## Current frontend role

The `server/` package appears to be a Next.js-based application with a custom Node server layered around it.
That means the package currently combines at least two different concerns:

1. **frontend/admin UI delivery**, and
2. **backend gateway behavior** such as HTTP MCP endpoints, WebSocket upgrade handling, and live runtime coordination.

## Maintenance guidance

When working in the frontend/UI side of OSG, keep these boundaries clear:

- The frontend is not the source of truth for runtime/session/workspace state.
- The backend registries and WS/MCP handling define the live coordination model.
- UI views should be treated as observers and operators of that model, not as alternate state authorities.
- Do not document frontend-visible fields as durable or canonical unless the backend/persistence path proves that.

## Frontend/backend interface constraints

For the current browser UI, maintain these constraints unless there is an explicit architectural reason to change them:

- The browser live-data path is `GET /api/monitor/stream`; treat `/api/nancymonitor/stream` only as a compatibility alias.
- Browser UI data must use the shared monitor contract in `server/lib/frontend/monitor-contract.ts`.
- Browser hooks must parse stream payloads through the shared reader instead of blind-casting JSON to UI types.
- The monitor stream is a UI read model only; it must not expose raw queue objects, registry bundles, or MCP transport details.
- Browser monitoring stays on SSE. Runtime ingress stays on `/api/v2/wsport`. Control actions stay on `/api/v2/mcp/*`.
- If the UI needs a new field, add it to the shared monitor contract first, then update the stream route and frontend consumer together.

## What to verify before making frontend claims

Before documenting or changing frontend behavior, check:

- where the displayed data is loaded from,
- whether it comes from live in-memory state or durable storage,
- whether disconnect/reconnect clears the underlying backend graph,
- whether a UI action maps to `runtime_control`, `session_bridge`, direct server action, or only local UI state.

## Current documentation gap

The existing repository docs still do not provide a good frontend component map or route-level UI ownership breakdown.
So for now this file is intentionally conservative:

- it establishes the backend/frontend distinction,
- warns maintainers not to confuse the two,
- and marks frontend structure as an area that still needs direct code reading before stronger documentation is written.
