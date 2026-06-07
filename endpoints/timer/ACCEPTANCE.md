# Timer Endpoint Acceptance Criteria

This document describes the current Rust-only acceptance target for
`timer-endpoint`.

## Current Scope

Accepted in this phase:

- Rust `timer-endpoint` Cargo package builds and runs.
- MCP JSON-RPC endpoints expose one-shot timer tools.
- One-shot timers are stored in memory and removed after firing.
- Fired timers send canonical OSGP `control/add_prompt` to the owner session.
- `ExecutorSessionID` is required as the first tool argument and is supplied by
  the external MCP host/runtime.

Out of scope in this phase:

- Node/JavaScript Timer implementation.
- Browser web UI and static file serving.
- Periodic timers.
- Cron timers.
- Runtime config reload.
- Durable timer persistence.

## Functional Criteria

### One-Shot Timers

- `CreateOneShotTimer` accepts positive integer `afterSeconds`.
- `CreateOneShotTimer` rejects zero or missing `afterSeconds`.
- `CreateOneShotTimer` rejects empty `msg`.
- Timer rows include `TimerID`, `RuntimeID`, `SessionID`,
  `ExecutorRuntimeID`, `ExecutorSessionID`, `Title`, `MSG`, `TimerType`,
  `DelaySeconds`, `created_at`, `trigger_at`, and `status`.
- Due one-shot timers are drained once and removed from the store.

### Ownership

- Self scope owner is `ExecutorSessionID`.
- Self scope runtime is injected `ExecutorRuntimeID` when present, otherwise
  the `runtimeID` query value.
- Manager scope owner is explicit target `runtimeID` / `sessionID`.
- Manager scope keeps injected `ExecutorSessionID` only as caller audit.
- Delete/list operations are scoped by owner runtime/session.

### MCP API

- `initialize` returns JSON-RPC 2.0 server metadata.
- `tools/list` returns current supported tools only.
- `tools/call` returns MCP text content containing JSON result data.
- Unsupported tools return JSON-RPC errors.
- Self tools:
  - `CreateOneShotTimer`
  - `DeleteRuntimeTimer`
  - `ListRuntimeTimers`
- Manager tools:
  - `CreateOneShotTimer`
  - `DeleteRuntimeTimer`
  - `ListRuntimeTimers`
  - `ListAllTimers`

### Executor Injection Contract

- Every tool schema lists `ExecutorSessionID` first in `required`.
- The endpoint validates `ExecutorSessionID` but does not generate it.
- Validation failure for missing `ExecutorSessionID` is explicit:
  `ExecutorSessionID is required`.
- Tests and demo records may show model-visible tool input without
  `ExecutorSessionID`; that is valid only when the MCP host injected it before
  the endpoint received the call.

### GV / OSGP Wire

- GV client connects by LinkHandshake and Announce.
- Legacy hello fallback is allowed only for transitional router compatibility.
- Timer fire envelope fields:
  - `type = "envelope"`
  - `kind = "control.add_prompt"`
  - `linkType = "control"`
  - `subtype = "add_prompt"`
  - `target = timer RuntimeID / SessionID`
  - flat `payload.sessionID`, `payload.msg`, `payload.system`
- Timer must not emit `timer.fired`, `timer.response`, or dynamic timer
  subtypes.

### HTTP

- `POST /mcp/timer_scheduler?runtimeID=<runtime>` handles self MCP requests.
- `POST /mcp/timer_manager` handles manager MCP requests.
- `GET /api/status` reports endpoint identity, GV connection state, and pending
  timer count.
- No static UI routes are required.

## Code Quality

- `cargo fmt --package timer-endpoint --check` passes.
- `cargo test -p timer-endpoint` passes.
- `cargo check --workspace` passes.
- `endpoints/timer` contains no JS service files, npm package metadata, or
  browser `web/` assets.
- No Timer Rust source file should exceed 500 lines; split tests/helpers when it
  would.

## Manual Demo Criteria

The session-owned demo passes only if:

- The target opencode session creates the timer through the Timer MCP surface.
- `ExecutorSessionID` is injected by the MCP host/runtime, not manually forged.
- The stored owner/target matches the creating session.
- At `trigger_at`, Timer sends exactly one `control/add_prompt` to that same
  session.
- The target session replies with the expected validation text.
- A later idle window shows no duplicate one-shot fire.
