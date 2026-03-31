# Server Plug IM Agent Workspace

## Scope

- Primary code root: `plugins/IM-bridge/`
- Covers IM provider bridges, upload/download flows, inbound forwarding, and OSG binding

## Read First

1. `docs/README.md`
2. `docs/_shared/project-overview.md`
3. `plugins/README.md`
4. `plugins/IM-bridge/README.md`

## Commands

- Run these from `agents/serverplug-im/`:
- `npm run dev`
- `npm run build`
- `npm run lint`
- `npm run probe`

## Runtime Area

- Agent-local runtime root: `agents/serverplug-im/.runtime/`
- IM bridge state and bridge workspaces default here
- Third-party adapter snapshots live under `agents/serverplug-im/vendor/`

## Boundary Rules

- `plugins/IM-bridge/` is the real OSG server plugin.
- The former Koishi probe now lives under `plugins/IM-bridge/plugins/koishi-lark/`.
- Keep provider-specific behavior behind the IM bridge boundary when possible.
