# OpenSessionGateway Server

Next.js 16 + TypeScript gateway server for runtime coordination, monitoring, and plugin-hosted MCP surfaces.

## Stack

- Next.js 16 + TypeScript
- Redis
- WebSocket runtime transport
- plugin host and local plugin admin server
- Prisma client and schema files present in repo

## Ports

- Gateway HTTP and WS: `4088`
- Local plugin admin: `127.0.0.1:4091`

## Setup

1. Install dependencies once from the repo root:

```bash
npm install
```

2. Copy env file:

```bash
cp .env.example .env
```

3. Set `REDIS_URL` for the current runtime paths. Keep `DATABASE_URL` if you want Prisma client paths available.

4. Run the gateway from `server/` directly:

```bash
npm run dev
```

You can also use the wrapper in `agents/server/` for normal agent-driven runs.

Open `http://localhost:4088`.

## Backend docs

- [`docs/backend/runtime-session-workspace-model.md`](./docs/backend/runtime-session-workspace-model.md)
- [`docs/backend/architecture-and-dataflow.md`](./docs/backend/architecture-and-dataflow.md)
- [`docs/backend/persistence-and-mailbox-notes.md`](./docs/backend/persistence-and-mailbox-notes.md)
- [`docs/backend/plugin-runtime-and-admin.md`](./docs/backend/plugin-runtime-and-admin.md)

Keep these notes in sync when runtime connection, activity tracking, sorting, persistence, or plugin runtime semantics change.

## Gateway routes

### HTTP

- `GET /`
- `GET /api/health`
- `GET /api/monitor/stream`
- `GET /api/nancymonitor/stream` (compatibility alias)
- `GET /api/v2/mcp/[surface]`
- `POST /api/v2/mcp/[surface]`

### WebSocket

- `ws://<host>:4088/api/v2/wsport`

### Current MCP surfaces

Core surfaces are plugin-backed and served through `/api/v2/mcp/[surface]`:

- `runtime_control`
- `session_bridge`
- `timer_scheduler`
- `timer_manager`

Additional surfaces such as `im_gateway_control` and `im_gateway_chat` appear only when that plugin is loaded.

### Local plugin admin

- `GET http://127.0.0.1:4091/`
- `GET http://127.0.0.1:4091/api/plugins`
- `POST http://127.0.0.1:4091/api/plugins/load`
- `POST http://127.0.0.1:4091/api/plugins/unload`
- `POST http://127.0.0.1:4091/api/plugins/reload`
- `POST http://127.0.0.1:4091/api/plugins/autoload`
- `POST http://127.0.0.1:4091/api/plugins/autoload/apply`

## Plugin runtime notes

Server startup runs plugin autoload before the main listeners are exposed.

- repo-shipped plugin packages live under `plugins/`
- local ad-hoc overrides live under `server/local-plugins/`
- file-loaded plugin packages run in `worker_threads`
- builtin in-process plugins are also supported by the host API
- load, unload, and reload do not require restarting the main OSG server

`IM-gateway` is currently opt-in and ships with `osgServerPlugin.autoload: false`, so its MCP surfaces appear only when loaded.

Override `OSG_PLUGIN_DIRS` explicitly if you want a custom root, for example:

```bash
OSG_PLUGIN_DIRS=D:\ai\OPENCODE_AUTO\OpenSessionGateway\plugins
```

Autoload can be constrained by package directory name:

```bash
OSG_PLUGIN_AUTOLOAD_ALLOW=IM-gateway,runtime-control,session-bridge,timer-scheduler
OSG_PLUGIN_AUTOLOAD_DENY=
```

If the plugin root contains `osg.plugins.json`, its `autoload.allow` / `autoload.deny` lists are used as the default startup filter. Env allow entries take precedence over file allow lists, while env and file deny entries are both applied.

When `OSG_PLUGIN_DIRS` is unset, the loader checks the repo `plugins/` root plus local override roots such as `server/local-plugins/`.

## Runtime dir note

The server runtime dir under `agents/server/.runtime/` is configured by `OSG_SERVER_RUNTIME_DIR`.
It currently backs port locks and related startup or shutdown cleanup, not durable live runtime or session state.
