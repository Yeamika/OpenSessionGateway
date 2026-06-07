# GlassVein Timer Endpoint

`endpoints/timer/` is the Rust Timer endpoint. It owns timer MCP tools,
in-memory one-shot scheduling, and the GV WebSocket adapter that sends
canonical `control/add_prompt` envelopes when timers fire.

The old Node/JavaScript endpoint and browser UI have been removed. Do not add
new Timer service code under `src/*.js`, `test/*.js`, `package.json`, or
`web/`.

## Boundaries

- Owns timer endpoint behavior, MCP-compatible JSON-RPC routes, timer storage,
  and GV connection adapter code.
- Does not modify or depend on changes to `core/`, `router/`, `osgp/`, or
  `clients/rust/`.
- Uses OSGP-shaped `source` / `target` addresses and canonical
  `control/add_prompt` fire delivery.
- Timer state is endpoint-local and in-memory. Timers are lost when the process
  exits.

## Layout

- `src/main.rs` - process entrypoint and scheduler loop.
- `src/config.rs` - JSON config and CLI config path loading.
- `src/timer_store.rs` - in-memory timer state and one-shot due draining.
- `src/mcp_api.rs` and `src/mcp_api/tests.rs` - MCP JSON-RPC tools.
- `src/gv_client.rs` - GlassVein WebSocket connection and send boundary.
- `src/osgp_wire.rs` - OSGP envelope helpers.
- `src/web.rs` - HTTP routes for MCP and status.
- `demo/` - manual timer/session validation notes.

## Start Locally

```sh
cd GlassVein
cargo run -p timer-endpoint -- --config endpoints/timer/config.example.json
```

If `--config` is omitted, safe local defaults are used. Runtime configuration is
file-driven, not environment-variable driven.

Config shape:

```json
{
  "listen": { "host": "127.0.0.1", "port": 8789 },
  "gv": {
    "routerUrl": "ws://127.0.0.1:7200",
    "domain": "domain-a",
    "runtimeID": "timer-endpoint",
    "sessionID": "timer",
    "sourceRuntime": "timer-endpoint",
    "sourceSession": "timer"
  }
}
```

## HTTP Endpoints

- `POST /mcp/timer_scheduler?runtimeID=<runtime>` - self-scope MCP endpoint.
- `POST /mcp/timer_manager` - manager-scope MCP endpoint.
- `GET /api/status` - health/status summary.

No static browser UI or config reload route is currently exposed by the Rust
endpoint.

## MCP Tools

Self scope:

- `CreateOneShotTimer`
- `DeleteRuntimeTimer`
- `ListRuntimeTimers`

Manager scope:

- `CreateOneShotTimer`
- `DeleteRuntimeTimer`
- `ListRuntimeTimers`
- `ListAllTimers`

`CreatePeriodicTimer`, `CreateCronTimer`, and `ReloadConfig` are not supported
in the current Rust endpoint.

## Executor Injection Contract

`ExecutorSessionID` is not chosen by the model, operator prompt, or test
harness. The MCP host/runtime injects it as the first required argument before
the Timer endpoint handles the tool call.

- Self tools use `ExecutorSessionID` as the owner/target session bucket.
- Self tools use injected `ExecutorRuntimeID` when present; otherwise they fall
  back to the `runtimeID` query parameter.
- Manager tools use injected `ExecutorSessionID` only for caller audit and
  require explicit target `runtimeID` / `sessionID`.
- The endpoint validates that `ExecutorSessionID` is present, but it does not
  mint or infer it from the request body.

## Fire Delivery

When a one-shot timer fires, the endpoint sends one canonical OSGP business
envelope:

- `type = "envelope"`
- `kind = "control.add_prompt"` for router compatibility
- `linkType = "control"`
- `subtype = "add_prompt"`
- `target = timer.RuntimeID / timer.SessionID`
- `payload.sessionID = timer.SessionID`
- `payload.msg = timer.MSG`
- `payload.system = timer metadata prompt`

The endpoint must not send legacy `timer.fired` or dynamic timer subtypes.

## Local Checks

```sh
cd GlassVein
cargo fmt --package timer-endpoint --check
cargo test -p timer-endpoint
cargo check --workspace
find endpoints/timer -type f \( -name '*.js' -o -name 'package.json' -o -path '*/web/*' \) -print
```
