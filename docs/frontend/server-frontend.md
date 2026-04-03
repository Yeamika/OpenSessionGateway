# OSG Frontend Notes

## Current ownership

The main interactive monitor/admin UI now lives in `web/`.
`server/app/page.tsx` is only a small gateway landing page with links to the web UI, health API, monitor stream, and plugin admin server.

## Browser data path

Current browser flow:

- `web/next.config.ts` rewrites `/api/:path*` to `OSG_GATEWAY_ORIGIN`
- the browser opens `EventSource("/api/monitor/stream")`
- the gateway serves that stream from `server/app/api/monitor/stream/route.ts`
- `/api/nancymonitor/stream` remains as a compatibility alias

Plugin admin is still separate on `127.0.0.1` with default port `4091`.

## Current contract drift

The server and web monitor contracts are not currently the same.

Current mismatches include:

- server uses `instanceWorkspaceDirectory`
- web uses `workspace`
- server runtime status is `online | offline`
- web still accepts `online | stale | offline`

Docs should not describe these as a unified contract until the code is aligned.

## Maintenance guidance

When working on the frontend side:

- treat the browser UI as an observer and operator of backend state, not as its own source of truth
- verify where displayed fields come from before calling them durable or canonical
- inspect both `server/lib/frontend/monitor-contract.ts` and `web/lib/monitor-contract.ts` before changing stream fields
- keep SSE, runtime WS, MCP, and plugin-admin concerns documented as separate paths
