# Timer Endpoint Memory

## Scope

- Applies to `GlassVein/endpoints/timer/` and its subdirectories.
- Timer endpoint is Rust-only. The old Node/JavaScript implementation and
  browser UI have been removed.
- Do not recreate Timer service code as `src/*.js`, `test/*.js`,
  `package.json`, or `web/` assets.

## Current Implementation

- Package: `timer-endpoint`
- Runtime: Rust, Cargo workspace member.
- HTTP framework: `axum`.
- GV transport: WebSocket via `tokio-tungstenite`.
- State: in-memory one-shot timers only.

## Key Files

- `src/main.rs` - endpoint process, scheduler loop, component wiring.
- `src/config.rs` - JSON configuration and CLI `--config` loading.
- `src/timer_store.rs` - timer state, ownership checks, due draining.
- `src/mcp_api.rs` - MCP JSON-RPC handlers and tool schemas.
- `src/mcp_api/tests.rs` - MCP API tests.
- `src/gv_client.rs` - GV WebSocket client and reconnect loop.
- `src/osgp_wire.rs` - LinkHandshake, Announce, and `control/add_prompt` fire
  envelope helpers.
- `src/web.rs` - MCP and status HTTP routes.
- `demo/` - manual validation notes.

## Current Capabilities

- Supported: `CreateOneShotTimer`, `DeleteRuntimeTimer`, `ListRuntimeTimers`,
  manager `ListAllTimers`.
- Not supported: periodic timers, cron timers, config reload, static browser UI.
- Timer fire delivery is canonical `control/add_prompt`; do not restore
  `timer.fired`, `timer.response`, or dynamic timer subtypes.

## Executor Injection Contract

- `ExecutorSessionID` is externally injected by the MCP host/runtime and is the
  first required tool argument.
- The model, operator prompt, scripts, and test harness must not forge
  `ExecutorSessionID`.
- Self scope uses `ExecutorSessionID` as the caller-owned target session bucket.
- Self scope uses injected `ExecutorRuntimeID` when present; otherwise it falls
  back to the `timer_scheduler?runtimeID=...` query.
- Manager scope uses injected `ExecutorSessionID` for caller audit only and
  requires explicit target `runtimeID` / `sessionID`.

## Configuration

Minimal config:

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

`peerId` is optional under `gv`; if omitted, the LinkHandshake uses
`gv.runtimeID`.

## Development Rules

- Keep single files under 500 lines. Move tests into child `tests.rs` modules
  when needed.
- Rust tests should be close to the module under test, using
  `#[cfg(test)] mod tests;` plus a sibling `tests.rs` file for larger suites.
- Do not add npm/Node test commands for this endpoint.
- Do not modify `core/`, `router/`, `osgp/`, or `clients/rust/` for Timer-only
  behavior.

## Checks

```sh
cd GlassVein
cargo fmt --package timer-endpoint --check
cargo test -p timer-endpoint
cargo check --workspace
find endpoints/timer -type f \( -name '*.js' -o -name 'package.json' -o -path '*/web/*' \) -print
```

## References

- `/workspace/OSG-Project/AGENTS.md`
- `/workspace/OSG-Project/GlassVein/AGENTS.md`
- `/workspace/OSG-Project/GlassVein/endpoints/timer/README.md`
