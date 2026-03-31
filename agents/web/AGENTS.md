# Web Agent Workspace

## Scope

- Primary code root: `web/`
- Read-only dependencies when needed: `server/app/api/monitor/stream/`, `server/app/api/health/`, `server/lib/frontend/monitor-contract.ts`

## Read First

1. `docs/README.md`
2. `docs/_shared/project-overview.md`
3. `docs/frontend/server-frontend.md`

## Commands

- Run these from `agents/web/`:
- `npm run dev`
- `npm run build`
- `npm run lint`

## Boundary Rules

- Treat `web/` as UI only.
- Keep gateway logic, MCP routing, runtime state, and plugin hosting in `server/`.
- The UI reaches the gateway through the rewrite in `web/next.config.ts`.
