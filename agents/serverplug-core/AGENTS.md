# Server Plug Core Agent Workspace

## Scope

- Primary code roots: `plugins/runtime-control/`, `plugins/session-bridge/`, `plugins/timer-scheduler/`
- Shared dependency: `packages/server-plugin-sdk/`

## Read First

1. `docs/README.md`
2. `docs/_shared/project-overview.md`
3. `docs/backend/mcp-endpoints-and-tools.md`
4. `plugins/README.md`

## Commands

- Run these from `agents/serverplug-core/`:
- `npm run dev`
- `npm run build`
- `npm run lint`
- `npm run build:sdk`

## Runtime Area

- Agent-local runtime root: `agents/serverplug-core/.runtime/`
- Use this workspace when you need a focused gateway runtime for runtime-control / session-bridge / timer-scheduler work

## Boundary Rules

- Keep these plugins focused on MCP surfaces and gateway-side control flows.
- Do not mix IM bridge behavior into this workspace.
- Preserve exact searchable identifiers such as `AddPromot` and `ClientContentExecuteing` when tracing protocol paths.
