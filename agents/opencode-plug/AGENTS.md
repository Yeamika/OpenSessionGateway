# OpenCode Plug Agent Workspace

## Scope

- Primary code roots: `packages/client-opencode-plugin-v2/`, `packages/client-library/`
- Reference docs: `docs/plugins/opencode-plugin-side.md`, `docs/plugins/modified-opencode-side.md`

## Read First

1. `docs/README.md`
2. `docs/_shared/project-overview.md`
3. `docs/plugins/opencode-plugin-side.md`
4. `docs/plugins/modified-opencode-side.md`

## Commands

- Run these from `agents/opencode-plug/`:
- `npm run build`
- `npm run build:library`
- `npm run build:plugin`
- `npm run build:template`
- `npm run fleet`

## Runtime Area

- Agent-local runtime root: `agents/opencode-plug/.runtime/`
- OpenCode log dir and client-template fleet workspace defaults are redirected here

## Boundary Rules

- Keep OpenCode runtime/plugin concerns here.
- Do not treat `packages/client-template/` as proof that the OpenCode integration implements the same behavior.
- Check protocol, server, and plugin behavior separately before claiming end-to-end support.
