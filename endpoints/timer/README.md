# GlassVein Timer Endpoint

`endpoints/timer/` is the Timer endpoint project. It contains the endpoint-local MCP server/API, a GV WebSocket client adapter, and the browser web frontend. The timer project intentionally lives under `GlassVein/endpoints/` rather than `integrations/osg/plugins/` or a standalone static surface directory.

## Boundaries

- Owns timer endpoint behavior, web assets, MCP-compatible JSON-RPC routes, and GV connection adapter code.
- Does not modify or depend on changes to `core/`, `router/`, `osgp/`, or `clients/rust/`.
- Uses canonical OSGP-shaped `source` / `target` addresses and `request` / `control` / `response` envelopes.
- Timer execution is endpoint-local in this first cut. Persistence is in-memory; durable storage can be added inside this endpoint later.

## Layout

- `src/main.js` — endpoint process entrypoint and configuration.
- `src/http-server.js` — static web, REST API, and MCP JSON-RPC HTTP routes.
- `src/mcp-api.js` — timer tool names and MCP call semantics.
- `src/timer-store.js` — timer state and scheduling.
- `src/cron.js` — five-field UTC cron parser and next-trigger scan.
- `src/gv-client.js` — GV WebSocket connection and send boundary.
- `src/osgp-wire.js` — OSGP envelope helpers.
- `web/` — browser UI, split into API, state, rendering, and orchestration modules.

## Start locally

No install step is required for the current no-dependency Node implementation.

```sh
cd GlassVein/endpoints/timer
npm start -- --config ./config.local.json
```

If `--config` is omitted, safe local defaults are used. Formal runtime configuration is file-driven, not environment-variable driven. Start from `config.example.json` and write a local untracked config file.

Config shape:

```json
{
  "listen": { "host": "127.0.0.1", "port": 8789 },
  "gv": { "routerUrl": "ws://127.0.0.1:7200", "runtimeID": "timer-endpoint" },
  "webExecutor": { "runtimeID": "timer-web-caller", "sessionID": "timer-web-session" }
}
```

Hot reload:

- HTTP: `POST /api/config/reload`
- MCP manager tool: `ReloadConfig` with `ExecutorSessionID`

Reload updates GV router URL, runtime/session/source/target defaults, and web executor defaults. Existing timers remain in memory and are not deleted by reload.

Web entry:

- `http://127.0.0.1:8789/`

MCP-compatible endpoints:

- manager: `POST /mcp/timer_manager`
- self: `POST /mcp/timer_scheduler?runtimeID=<runtime>`

Web/API endpoint:

- `GET /api/status`
- `POST /api/timers` with `{ "tool": "ListRuntimeTimers", "arguments": { ... } }`

## Tool mapping

The endpoint keeps the existing timer tool names:

- `CreateOneShotTimer`
- `CreatePeriodicTimer`
- `CreateCronTimer`
- `DeleteRuntimeTimer`
- `ListRuntimeTimers`
- manager `ListAllTimers`

Create/delete operations map to OSGP `control` envelopes; list operations map to OSGP `request` envelopes. Timer fire notifications are sent as `control` envelopes with subtype `timer.fired` when `gv.routerUrl` is configured and connected.

## Caller/session audit

- Self MCP tools follow the old OSG convention: `runtimeID` comes from the `timer_scheduler?runtimeID=...` query and `ExecutorSessionID` names the caller/current session bucket.
- Manager MCP tools require `ExecutorSessionID` for caller audit in addition to target `runtimeID`/`sessionID` where applicable.
- Target `sessionID` is never treated as the caller. Timer rows store `ExecutorSessionID` separately from `SessionID`.
- Web/API calls inject the endpoint web caller from config `webExecutor.runtimeID` / `webExecutor.sessionID` before invoking manager tools.

## Current limits

- Cron uses a five-field UTC parser compatible with the old timer scheduler. It scans up to five years for the next matching minute.
- Timers are in-memory and are lost when the endpoint process exits.
- If no GV router URL is configured, MCP/API/web still work locally, but fire delivery reports a disconnected GV adapter in timer status.

## Manual validation

Timer/session demo sequence:

- [`demo/README.md`](demo/README.md) defines the target-session-owned timer demo.
- In that demo, the target session must create the one-shot timer itself through
  the Timer MCP surface; external test harness creation is not acceptable.
- When the timer fires, the Timer endpoint must send canonical
  `control/add_prompt` to the same target session and prove busy → reply → idle
  timing with no duplicate one-shot fire.

General local checks:

```sh
cd GlassVein
find endpoints/timer -type f -print0 | xargs -0 wc -l
cd endpoints/timer && npm run check
cd endpoints/timer && npm test
cd ../..
rg 'legacy surface identity pattern' endpoints/timer || true
find core router osgp clients/rust -type f -mmin -10 -print
```
