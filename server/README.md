# OpenSessionGateway Server

Next.js 16 + TypeScript server for runtime monitoring and gateway control.

## Stack

- Next.js 16 + TypeScript
- PostgreSQL
- Redis
- shadcn/ui + Tailwind CSS v4

## Runtime Port

- Dev: `4088`
- Start: `4088`

## Plugin Admin Port

- Default: `4091`
- Bind: `127.0.0.1` only

## Setup

1. Install dependencies once from the repo root:

```bash
npm install
```

2. Copy env file:

```bash
cp .env.example .env
```

3. Ensure DB URL points to database `opensession_gateway`.
4. If you need Prisma manually:

```bash
npx prisma generate
```

5. Run development server from `agents/server/`:

```bash
npm run dev
```

Open `http://localhost:4088`.

## Backend docs

- [`docs/backend/runtime-session-workspace-model.md`](./docs/backend/runtime-session-workspace-model.md)
- [`docs/backend/architecture-and-dataflow.md`](./docs/backend/architecture-and-dataflow.md)
- [`docs/backend/persistence-and-mailbox-notes.md`](./docs/backend/persistence-and-mailbox-notes.md)
- [`docs/backend/plugin-runtime-and-admin.md`](./docs/backend/plugin-runtime-and-admin.md)

Keep these notes in sync when runtime connection, activity tracking, sorting, or persistence semantics change.

## API Endpoints

### HTTP Endpoints

- `GET /` (NancyMonitor)
- `GET /api/health`
- `GET /api/nancymonitor/stream`
- `GET /api/v2/mcp/session_bridge`
- `POST /api/v2/mcp/session_bridge`
- `GET /api/v2/mcp/runtime_control`
- `POST /api/v2/mcp/runtime_control`

### Local Plugin Admin

- `GET http://127.0.0.1:4091/`
- `GET http://127.0.0.1:4091/api/plugins`
- `POST http://127.0.0.1:4091/api/plugins/load`
- `POST http://127.0.0.1:4091/api/plugins/unload`
- `POST http://127.0.0.1:4091/api/plugins/reload`
- `POST http://127.0.0.1:4091/api/plugins/autoload`
- `POST http://127.0.0.1:4091/api/plugins/autoload/apply`

Server startup runs plugin autoload before the main listeners are exposed. Runtime-loaded plugin packages are discovered from configured plugin roots and isolated in `worker_threads`, and load, unload, or reload does not require restarting the main OSG server.

Repo-shipped plugins now live under `plugins/`. Local ad-hoc overrides live under `server/local-plugins/`.

The server runtime dir under `agents/server/.runtime/` is configured by `OSG_SERVER_RUNTIME_DIR`. It currently holds port locks and related startup or shutdown cleanup, not durable live runtime or session state.

Override `OSG_PLUGIN_DIRS` explicitly if you want a custom root, for example:

```bash
OSG_PLUGIN_DIRS=D:\ai\OPENCODE_AUTO\OpenSessionGateway\plugins
```

Autoload can be constrained by package directory name:

```bash
OSG_PLUGIN_AUTOLOAD_ALLOW=runtime-control,session-bridge,timer-scheduler
OSG_PLUGIN_AUTOLOAD_DENY=IM-bridge
```

If the plugin root contains `osg.plugins.json`, its `autoload.allow` / `autoload.deny` lists are used as the default startup filter. Env allow entries take precedence over file allow lists, while env and file deny entries are both applied.

Plugin packages can also opt out of startup autoload with `osgServerPlugin.autoload: false` in their own `package.json`.

When `OSG_PLUGIN_DIRS` is unset, the loader checks the repo `plugins/` root plus local override roots such as `server/local-plugins/`.

### WebSocket

- `ws://<host>:4088/api/v2/wsport`
