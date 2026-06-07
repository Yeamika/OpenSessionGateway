# Timer Endpoint Rust Migration Status

The Timer endpoint has migrated to Rust-only service code.

## Closed

- Removed the old Node/JavaScript service implementation.
- Removed old Node test files and npm package metadata.
- Removed stale browser UI assets from `web/`.
- Added/kept Rust modules for config, MCP API, timer store, GV WebSocket client,
  OSGP wire helpers, and HTTP routing.

## Current Rust Surface

- Package: `timer-endpoint`
- Entry: `src/main.rs`
- HTTP:
  - `POST /mcp/timer_scheduler?runtimeID=<runtime>`
  - `POST /mcp/timer_manager`
  - `GET /api/status`
- Supported tools:
  - `CreateOneShotTimer`
  - `DeleteRuntimeTimer`
  - `ListRuntimeTimers`
  - manager `ListAllTimers`
- Unsupported tools:
  - `CreatePeriodicTimer`
  - `CreateCronTimer`
  - `ReloadConfig`

## Executor Contract

The MCP host/runtime injects `ExecutorSessionID` before requests reach the Timer
endpoint. Timer requires it as the first tool argument and uses it as the self
scope session owner. The endpoint does not generate, infer, or trust a
model-authored session owner.

## Remaining Work

- Implement periodic timers only if product scope reopens that feature.
- Implement cron timers only if product scope reopens that feature.
- Add durable storage if timers must survive process restart.
- Add a Rust-served UI only if a real frontend requirement returns.
- Decide whether strict clippy with `-D warnings` is a project gate for this
  endpoint; if so, clean the remaining endpoint and dependency warnings.

## Checks

```sh
cd GlassVein
cargo fmt --package timer-endpoint --check
cargo test -p timer-endpoint
cargo check --workspace
find endpoints/timer -type f \( -name '*.js' -o -name 'package.json' -o -path '*/web/*' \) -print
```
