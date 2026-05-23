<!-- canonical: binary/program layout and commands -->
# Multi-node program split

The split is package/program oriented for router and surfaces. `glassvein-demos` remains the place for in-process showcases and fake client binaries.

## Independent packages/programs

- `router` (`router/`): router package/program CLI scaffold.
- `control-endpoint` (`endpoints/control/`): control endpoint binary; builds addprompt/abort/compact envelopes. (was `control-surface`)
- `surface-viewer` (`endpoints/viewer/`): surface viewer binary; configures observation filters for session_update / traffic streams. (was `observer-surface`)
- `requestion-endpoint` (`endpoints/requestion/`): requestion endpoint binary. (was `requestion-surface`)
- ~~`glassvein-opencode-router`~~ (`crates/glassvein-opencode-router/`): *(removed from workspace; replaced by `integrations/opencode/plugin/`)* opencode router end-side binary.

## Fake client demo binaries

`osgp-client` (was `clientlib` + `clientroute`) is the client SDK. Demo clients are independent binaries inside the `glassvein-demos` package:

- `alpha-client`: fake client with `small-text` upload behavior.
- `beta-client`: fake client with `chunked` upload behavior.
- `gamma-client`: fake client with `none` upload behavior.

Example commands:

```bash
cargo run -p router -- --node-id root-router --bind-addr 127.0.0.1:7200
cargo run -p router -- --node-id east-router --bind-addr 127.0.0.1:7201 --upstream-url ws://127.0.0.1:7200
cargo run -p control-endpoint -- --router-url ws://127.0.0.1:7201 --command addprompt --target domain-a/runtime-alpha/session-alpha
cargo run -p surface-viewer -- --router-url ws://127.0.0.1:7201 --kind-filter session_update
cargo run -p glassvein-demos --bin alpha-client -- --upload-mode small-text
cargo run -p glassvein-demos --bin beta-client -- --upload-mode chunked
cargo run -p glassvein-demos --bin gamma-client -- --upload-mode none
```

## Fake client boundary

The client binaries are explicitly **FAKE CLIENT** programs. They use `osgp-client` (was `clientlib`) config types and document the existing `FakeTransportHub` / in-process simulation model. They print intended router URL, address, and upload behavior/session information, but they do not connect to a real router or upload data.

## Capability boundary

These entries are low-risk CLI/config scaffolds. They do not open WebSocket listeners, connect to upstream routers, or perform real cross-process routing yet. Real WS transport remains future adapter work.
