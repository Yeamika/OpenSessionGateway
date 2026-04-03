# OpenSessionGateway

Workspace for the OpenSessionGateway project.

## Layout

- `agents/`: isolated run wrappers, runtime state, and shared OpenCode config
- `docs/`: project, backend, frontend, plugin, and maintenance notes
- `web/`: main interactive monitor/admin UI
- `server/`: gateway APIs, WebSocket runtime port, monitor SSE, and local plugin admin server
- `packages/protocol-library/`: shared WS protocol contracts
- `packages/client-library/`: reusable OSG runtime client
- `packages/client-opencode-plugin-v2/`: OpenCode-facing OSG client integration
- `packages/client-template/`: example and smoke-test client
- `packages/server-plugin-sdk/`: reusable SDK for server-side plugins
- `plugins/`: canonical repo-shipped OSG server plugins such as `runtime-control`, `session-bridge`, `timer-scheduler`, and `IM-gateway`
- `server/local-plugins/`: local override plugin root for ad-hoc packages

Agent-owned non-code areas live under `agents/`, for example:

- `agents/server/.runtime/`: gateway locks, logs, heap dumps, and startup/runtime support files
- `agents/opencode-plug/.runtime/`: OpenCode runtime logs and client-template fleet workspaces
- `agents/serverplug-im/.runtime/`: IM gateway state, uploads, and provider workspaces
- `agents/server/.archive/`: historical backup material
- `agents/serverplug-im/vendor/`: third-party IM adapter source snapshots and tarballs

## Documentation

See `docs/README.md` for the working architecture notes and `server/README.md` for the current gateway runtime surface.

## Build Notes

- Recommended flow:
  - Run `npm install` at the workspace root once to populate the shared `node_modules/` for the whole repo.
  - Use the `agents/*` wrappers for normal dev, build, and lint flows.
  - Use the code workspaces directly when you need package-local commands or implementation inspection.
- `web/` owns the main UI. `server/` owns the gateway APIs, WS runtime port, SSE monitor stream, and plugin admin server.
- `packages/client-opencode-plugin-v2/` depends on private `@opencode-ai` packages. Those packages must already exist in the local registry before running `npm install`.
- `server/` still generates a Prisma client during gateway builds even though current live runtime state is mostly in-memory.
- If dependency install behavior looks stale or still points at an old local tarball path, regenerate `package-lock.json` from the current registry before retrying `npm install`.

### Agent Entry Points

- `agents/web/` -> `npm run dev|build|lint|start`
- `agents/server/` -> `npm run dev|build|pluginbuild|lint|start`
- `agents/opencode-plug/` -> `npm run build|build:library|build:plugin|build:template|fleet`
- `agents/serverplug-im/` -> `npm run dev|build|lint|probe`
- `agents/serverplug-core/` -> `npm run dev|build|lint|build:sdk`
- `agents/opencode-dev/` -> `npm run build|typecheck|test|serve`
- `agents/opencode-test/` -> `npm run typecheck|test|build`
- `agents/opencode-release/` -> `npm run build-cli|build-local-cli|publish-script`
