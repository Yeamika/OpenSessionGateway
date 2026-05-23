<!-- historical / pre-cleanup: references pre-convergence crate names (session-links, clientlib, clientroute, etc.). These names are historical only; see AGENTS.md for current canonical names. -->

# OSGP GLM Parallel Implementation Tasks

Purpose: split the OpenSessionGateway Protocol (OSGP) convergence into independent GLM-friendly work units. All tasks are local-only: no deployment, no publishing, no container operations, no service restart, and no real multi-node chain test unless explicitly re-authorized.

Authoritative protocol input: `docs/OPENSESSIONGATEWAY_PROTOCOL.md`.

## Global constraints

- Router network roles are only `endpoint` and `router`.
- Endpoint capabilities are opaque weak tags; only `surface_viewer` is used for local upload fan-out.
- Business wire uses only `type=upload|control|request|response` plus `subtype`.
- `upload` has no business target and is not route-table forwarded.
- `control`, `request`, and `response` have explicit targets and use endpoint route forwarding.
- Do not restore `ObserverSurface`, `ControlSurface`, `kind`, `control.command`, standalone `permission`, standalone `question`, `list_runtime_question`, or `list_runtime_permission` as main-chain protocol.
- Router must not perform user-layer authorization.

## Parallel task matrix

### Task A — `session-links` canonical schema

Inputs:

- `docs/OPENSESSIONGATEWAY_PROTOCOL.md`
- `crates/session-links/src/lib.rs`
- `crates/surface/src/control.rs`
- `crates/surface/src/query.rs`

Outputs:

- Canonical OSGP envelope/schema types for `upload`, `control`, `request`, and `response`.
- Control subtype coverage: `add_prompt`, `abort_session`, `compact_session`, `create_session`, `rename_session`, `resume_session`, `requestion_respond`.
- Request subtype coverage: `list_workspaces`, `read_workspace_info`, `list_session_messages`, `session_update_snapshot`, `requestion_snapshot`, `runtime_requestion_snapshot`, `session_view_snapshot`, optional `session_update_subscribe`.
- Response constructors that always require subtype and preserve `requestId`/`correlationId`.
- Removal or quarantine of legacy `kind` fallback from business dispatch.

Acceptance commands:

```bash
cargo test -p session-links
cargo test -p surface --no-run
```

Forbidden:

- Adding compatibility dispatch for `control.command`.
- Re-adding independent question/permission request subtypes.
- Making router/core depend on business payload internals.

### Task B — Pingora-only router OSGP proxy

Inputs:

- `crates/router/src/connection/pingora_listener.rs`
- `crates/router/src/connection/peer.rs`
- `crates/router/src/envelope_forward/legacy.rs`
- `crates/router/src/envelope_forward/typed.rs`
- `crates/router/src/read_forward.rs`
- `crates/router/src/transport.rs`
- `docs/OPENSESSIONGATEWAY_PROTOCOL.md`

Outputs:

- Router listener path treated as Pingora-based canonical path.
- Hello accepts only `endpoint`/`router` and stores `capabilities`.
- Native OSGP business frame parser/dispatcher for `type` + `subtype`.
- `upload` local fan-out only to directly connected endpoint peers with `surface_viewer`.
- `control/request/response` target routing by endpoint address/route.
- No user-layer role or authorization logic in router.
- Internal tap/debug paths clearly separated from OSGP user-layer behavior.

Acceptance commands:

```bash
cargo test -p router --features pingora-listener --no-run
cargo test -p router --no-run
```

Forbidden:

- Real chain smoke tests.
- Any deployment/container/service operation.
- Reintroducing observer/control surface roles into router roles or permissions.

### Task C — TypeScript OSGP SDK/client

Inputs:

- `integrations/opencode/plugin/src/glassvein-router/glassvein-ws-client.ts`
- `integrations/opencode/plugin/src/opencode/server-event.ts`
- `examples/osgp-ts-endpoint/`
- `docs/OPENSESSIONGATEWAY_PROTOCOL.md`

Outputs:

- Typed TS OSGP client with Hello `role="endpoint"` and optional `capabilities`.
- Helpers for upload/control/request/response envelopes without `kind`.
- Response correlation utilities preserving subtype and `requestId`/`correlationId`.
- No new use of `opencode_event` as an OSGP main-chain subtype.
- Generated `dist/` refreshed only if explicitly asked; otherwise source-only is acceptable.

Acceptance commands:

```bash
npm run typecheck --prefix integrations/opencode/plugin
```

Forbidden:

- Publishing npm packages.
- Restoring `client`, `control_surface`, or `observer_surface` as wire roles.
- Adding legacy `kind` or `control.command` fallbacks.

### Task D — Rust endpoint SDK/example

Inputs:

- `crates/clientlib/`
- `crates/clientroute/`
- `examples/osgp-rust-endpoint/`
- `docs/OPENSESSIONGATEWAY_PROTOCOL.md`

Outputs:

- Rust endpoint helper API for ordinary WebSocket clients; endpoint side must not require Pingora.
- Hello helper for `endpoint` + capabilities.
- Envelope builders for all four OSGP link types.
- Optional example using a normal WS client crate. Do not recommend `tokio-tungstenite` as the production dependency.

Acceptance commands:

```bash
cargo test -p clientlib --no-run
cargo test -p clientroute --no-run
```

Forbidden:

- Adding Pingora as an endpoint/client requirement.
- Coupling endpoint SDK to router internals.
- Creating workspace crate cycles.

### Task E — Local demo/harness refresh

Inputs:

- `demos/gv-network-validation.rs`
- `demos/ws-client-demo.rs`
- `demos/alpha-client/`
- `demos/beta-client/`
- `demos/gamma-client/`
- `crates/control-surface/src/main.rs`
- `crates/observer-surface/src/main.rs`
- `crates/requestion-surface/src/main.rs`

Outputs:

- Every Hello uses `role="endpoint"` or `role="router"` only.
- Viewer-like demos use `capabilities:["surface_viewer"]`.
- Demo labels and assertions use `type`/`subtype`, not `kind`.
- Harness examples cover upload/control/request/response locally without external deployment.

Acceptance commands:

```bash
cargo check -p glassvein-demos
cargo check -p control-surface
cargo check -p observer-surface
cargo check -p requestion-surface
```

Forbidden:

- Real router chain smoke execution unless explicitly requested.
- Relying on local tap events as the user-layer observer mechanism.

### Task F — Protocol/docs cleanup

Inputs:

- `docs/`
- `demos/`
- `integrations/opencode/plugin/src/`
- legacy non-workspace crates under `crates/glassvein-*` if still retained.

Outputs:

- Docs consistently use OSGP naming.
- Old protocol names moved to historical/deprecated notes only.
- Residual `kind`, `control.command`, `ObserverSurface`/`ControlSurface` role references either removed or explicitly marked legacy/non-OSGP.

Acceptance commands:

```bash
rg 'control\.command|observer_surface|control_surface|"role"\s*:\s*"client"|run_observer_writer' .
rg 'opencode_event|kind' integrations/opencode/plugin/src docs demos crates/session-links crates/router crates/surface
```

Forbidden:

- Editing generated `dist/` as the only source of truth.
- Hiding old protocol behavior without marking it legacy or removing it.

## Current residual/blocker list for GLM follow-up

Already safe-patched in this pass:

- Main workspace Hello examples/binaries now prefer `endpoint`/`router` and add `surface_viewer` where viewer-like.
- `ReadResponse` helpers now require subtype at internal call sites touched by this pass.
- `run_observer_writer` was removed from current router connection writer modules.
- Current surface observer/demo `control.command` text was replaced with subtype-style labels.

Still needs GLM cleanup:

- `crates/session-links/src/lib.rs` still has legacy `canonical_type_subtype(...).unwrap_or("unknown")` for old `SessionEnvelope::new` compatibility during convergence.
- `SessionEnvelope` still contains legacy/internal `kind`; remove or quarantine after schema task lands.
- `integrations/opencode/plugin/src/gvplugin/event-mapper.ts` still uses internal `kind` and old `opencode_event` mapping; migrate to OSGP upload subtypes or remove from main chain.
- `integrations/opencode/plugin/dist/` contains stale generated declarations with old roles/kind; rebuild only after source convergence is accepted.
- Non-workspace legacy crates such as `crates/glassvein-osg-surface/`, `crates/glassvein-core/`, `crates/glassvein-router/`, and `crates/glassvein-clientlib/` still contain historical role/kind naming. Decide whether to delete, archive, or update them.
- `demos/gv-network-validation.rs` still has legacy `SessionEnvelope` compatibility scaffolding and should become a pure canonical OSGP harness in Task E.
