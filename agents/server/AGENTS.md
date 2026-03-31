# Server Agent Workspace

## Scope

- Primary code root: `server/`
- Owns gateway API routes, WS upgrade handling, runtime/session/workspace live state, and plugin hosting

## Read First

1. `docs/README.md`
2. `docs/_shared/project-overview.md`
3. `docs/backend/architecture-and-dataflow.md`
4. `docs/backend/mcp-endpoints-and-tools.md`
5. `docs/backend/runtime-session-workspace-model.md`
6. `docs/backend/persistence-and-mailbox-notes.md`

## Commands

- Run these from `agents/server/`:
- `npm run dev`
- `npm run build`
- `npm run pluginbuild -- <plugin-name>`
- `npm run lint`

## Runtime Area

- Agent-local runtime root: `agents/server/.runtime/`
- Default gateway runtime path is injected with `OSG_SERVER_RUNTIME_DIR`

## Boundary Rules

- Keep frontend-only UI work in `web/`.
- Treat `runtimeID` as the main live routing anchor.
- Do not assume protocol definitions prove runtime behavior.
