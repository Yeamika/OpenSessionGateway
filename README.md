# OpenSessionGateway

Workspace for the OpenSessionGateway project.

## Layout

- `agents/`: isolated agent workspaces, runtime state, and non-code support assets; keep agent coordination here, not in product code roots
- `web/`: Next.js frontend for the monitor/admin UI
- `server/`: Next.js + WebSocket gateway server
- `packages/protocol-library/`: shared WS protocol contracts
- `packages/client-library/`: reusable OSG runtime client
- `packages/client-opencode-plugin-v2/`: OpenCode-facing OSG plugin package
- `packages/client-template/`: example/test client package
- `packages/server-plugin-sdk/`: reusable SDK for server-side plugins
- `plugins/`: canonical repo-shipped OSG server plugins
- `server/local-plugins/`: local override plugin root for ad-hoc packages

Agent-owned non-code areas now live under `agents/`, for example:

- `agents/server/.runtime/`: gateway locks, logs, heap dumps, and live runtime state
- `agents/opencode-plug/.runtime/`: OpenCode/client runtime logs and fleet workspaces
- `agents/serverplug-im/.runtime/`: IM bridge state and bridge workspaces
- `agents/server/.archive/`: historical backup material
- `agents/serverplug-im/vendor/`: third-party IM adapter source snapshots and tarballs

## Documentation

See `docs/README.md` for the current working architecture and maintenance notes.

## Build Notes

- Recommended flow:
  - Run `npm install` at the workspace root once to populate the shared `node_modules/` for the whole repo.
  - Run runtime, dev, lint, and build commands from the relevant `agents/*` directory, not from code roots.
  - If you want a root shortcut, the root `build:*` scripts now delegate into `agents/*` wrappers instead of calling code workspaces directly.
- UI now lives in `web/`, while the runtime gateway and API surface stay in `server/`.
- Use the local npm registry on `desktop-phi` when installing workspace dependencies. If install logs show requests going to `mechrevo:4873`, check `C:\Users\yes\.npmrc` and update `registry=http://desktop-phi:4873/`.
- `packages/client-opencode-plugin-v2/` depends on private `@opencode-ai` packages. Those packages must already exist in the local registry before running `npm install`.
- `server/` still generates Prisma client during gateway builds. Use `agents/server/` for normal gateway runs.
- If dependency install behavior looks stale or still points at an old local tarball path, regenerate `package-lock.json` from the current registry before retrying `npm install`.

### Agent Entry Points

- `agents/web/` -> `npm run dev|build|lint`
- `agents/server/` -> `npm run dev|build|lint|start`
- `agents/opencode-plug/` -> `npm run build|build:library|build:plugin|build:template|fleet`
- `agents/serverplug-im/` -> `npm run dev|build|lint|probe`
- `agents/serverplug-core/` -> `npm run dev|build|lint|build:sdk`
- `agents/opencode-dev/` -> `npm run build|typecheck|test|serve`
- `agents/opencode-test/` -> `npm run typecheck|test|build`
- `agents/opencode-release/` -> `npm run build-cli|build-local-cli|publish-script`
