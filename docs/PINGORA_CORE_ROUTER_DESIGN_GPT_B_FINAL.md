<!-- historical / pre-cleanup: design debate document -->
# GPT-B Round 3 final unified design draft

## Convergence status

GPT-A and GPT-B are now aligned on the material architecture. There is no remaining architecture disagreement requiring user裁决 for the immediate implementation path.

The unified position is:

> **Adapter first, policy last.** Core provides feature-gated Pingora WebSocket transport primitives and raw frame I/O. Router adapts those raw frames through its local `link_io.rs` seam, keeps Hello/peer/dispatch/read/tap policy, and only selects Pingora at runtime through explicit config. ForwardEngine convergence is deferred until after the inbound Pingora listener path is stable and tested.

## Highest-priority constraints

From Manager/user requirements:

- Do not deploy, publish, operate containers, or perform server operations in this phase.
- Do not write implementation code from this design task.
- `core` may contain Pingora transport adapter code, but must not absorb `requestion`, `session_update`, `opencode`, `permission`, `question`, observer, surface, or read-policy semantics.
- `router` keeps peer lifecycle, Hello, dispatch, observer broadcast, ReadRequest authorization, error replies, route learning, and runtime policy.
- WebSocket remains the unified wire transport.
- `tokio-tungstenite` may remain the WebSocket codec while Pingora owns server/listener/runtime accept.
- ForwardEngine full convergence is high risk and must not be done in the Pingora listener integration batch.

## Final agreed design points

### 1. Core boundary

Core owns:

- `Transport` / `TransportFactory` abstractions.
- Feature-gated `core::transport::pingora` adapter.
- `PingoraTransport`, `PingoraServerApp`, `PingoraTransportFactory`.
- Raw WebSocket text operations on Pingora transport:
  - `send_text`
  - `recv_text`
  - `close_ws`
- Typed `Transport::{send, recv, close}` convenience for `LinkMessage`.
- Transport-neutral route/next-hop/TTL/trace decision primitives.

Core must not own:

- Hello parsing or router role semantics.
- Peer registry, route cleanup, reconnect/backoff, or listener orchestration policy.
- Observer tap/broadcast policy.
- `ReadRequest` authorization, permission denial, error replies, or surface reply routing.
- Business payload semantics such as requestion/session_update/opencode/permission/question.
- Client/surface runtime behavior.

### 2. Router boundary

Router owns:

- `ConnectionManager` and peer lifecycle.
- Hello handshake and `PeerRole` / `WireRole` interpretation.
- `link_io.rs` frame seam.
- `WireFrame`, `FrameReader`, `FrameSink`, and writer loops.
- `PingoraLinkAcceptor` as a router-side adapter over core Pingora transport factory.
- `handle_incoming_link` shared logic over router frame I/O.
- Dispatch of `LinkMessage` into envelope/read forwarding.
- Observer tap semantics and local-only visibility.
- Explicit listener backend config selection.

Router must not expose Pingora types in non-cfg generic connection APIs beyond the cfg-gated adapter boundary.

### 3. `link_io.rs` is the correct seam

Both GPT-A and GPT-B agree that `link_io.rs` is the right seam because it already separates router protocol processing from concrete WebSocket implementation.

Final rule:

- `WireFrame` remains router-local.
- Do not move `WireFrame` into core.
- Adapt Pingora to existing `FrameReader` / `FrameSink` trait shape; do not modernize trait style unless required by implementation constraints.

### 4. Accepted-link seam replaces `Box<dyn core::Transport>` for listener accept

The initial Pingora listener path must not hand router a plain `Box<dyn core::Transport>`.

Reason:

- Hello is raw JSON, not `LinkMessage`.
- Observer `tap_event` frames are raw JSON, not `LinkMessage`.
- `Transport::recv()` parses typed `LinkMessage` and may skip non-typed frames, which is wrong before Hello registration.

Final accepted seam:

```text
LinkAcceptor::accept() -> Result<Option<AcceptedLink>>

AcceptedLink {
    peer_addr: String,
    reader: Box<dyn FrameReader + Send>,
    sink: Box<dyn FrameSink + Send>,
}
```

An equivalent single `FrameIo` object is acceptable if split ownership is awkward, but it must expose raw frame read/write semantics to router.

### 5. Raw-vs-typed layering

Final invariant:

```text
Hello / tap / raw JSON path:
    PingoraTransport::{send_text, recv_text, close_ws}
        -> router WireFrame / FrameReader / FrameSink
        -> router Hello, tap, LinkMessage parsing

Typed LinkMessage path:
    core Transport::{send, recv, close}
        -> LinkMessage only
```

Initial listener integration uses the raw path. Later pure message-only paths may evaluate direct typed `Transport` use after handshake/tap concerns are isolated.

### 6. Runtime feature/config behavior

Feature flags compile code; runtime config selects behavior.

Final behavior:

- No `router/pingora-listener` feature: only default Tokio/Tungstenite listener exists.
- Feature enabled but default config: still uses default Tokio/Tungstenite listener.
- Feature enabled plus explicit Pingora backend config: downstream listener uses core Pingora accept path.

Do not silently switch listener backend merely because a Cargo feature is enabled.

### 7. Upstream remains unchanged in immediate phase

Router upstream outbound connection remains `tokio_tungstenite::connect_async` for this implementation batch.

Reason:

- Current goal is inbound downstream listener/accept entering the core Pingora transport path.
- `PingoraTransportFactory::connect()` is server-side only.
- Upstream reconnect/backoff policy belongs to router.
- Changing upstream simultaneously expands regression risk.

### 8. ForwardEngine convergence is deferred

No ForwardEngine implementation convergence in the immediate Pingora listener integration phase.

ForwardEngine/core convergence may be revisited only after:

1. frame seam extraction passes;
2. Pingora frame adapter passes;
3. Pingora listener accept path passes local validation;
4. tests and observability are stable.

Any later convergence must be a separate design cycle and must keep read forwarding, observer tap, permissions, error replies, and surface routing in router unless explicitly redesigned.

## Final phase plan

### Phase 0 — design lock

- Accept this unified design.
- Freeze boundaries and raw-vs-typed layering.
- No code changes in this design phase.

### Phase 1 — shared frame-I/O handler extraction

Goal: make existing default listener use a transport-agnostic router frame seam.

Actions for implementation workers:

- Extract current post-WebSocket-accept logic into conceptual `handle_incoming_link(peer_addr, reader, sink)`.
- Existing `handle_incoming_connection<S>()` remains as default Tokio/Tungstenite wrapper.
- Default listener behavior must remain unchanged.
- Use existing `FrameReader` / `FrameSink` trait style.

### Phase 2 — Pingora frame adapter

Goal: adapt core Pingora raw frame API to router frame I/O.

Actions:

- Add cfg-gated `PingoraFrameReader` / `PingoraFrameSink` or `PingoraFrameIo`.
- Use `PingoraTransport::recv_text()` for raw receive.
- Use `PingoraTransport::send_text()` for raw send.
- Use `PingoraTransport::close_ws()` for close.
- Keep JSON parsing in router.

### Phase 3 — PingoraLinkAcceptor and explicit config selection

Goal: first functional inbound Pingora listener path.

Actions:

- Implement router-local `AcceptedLink` or equivalent `FrameIo` accepted object.
- Implement `PingoraLinkAcceptor` wrapping `PingoraTransportFactory`.
- Add explicit listener backend config, e.g. `TokioTungstenite` / `Pingora`.
- `ConnectionManager` consumes generic accepted links, not Pingora server internals.
- Default config remains Tokio/Tungstenite.

### Phase 4 — validation hardening

Goal: prove behavior parity and rollback safety.

Validation focus:

- Existing default listener tests pass with and without feature.
- Feature enabled + default config does not start Pingora listener.
- Config requests Pingora without feature gives clear error.
- Pingora raw frame path completes Hello.
- Invalid Hello / invalid role fails before peer registration.
- Closed-before-Hello does not leave peer or route state.
- Observer tap remains local and router-owned.
- Read permission and error reply behavior unchanged.
- Core business grep remains clean.
- `session-links` remains network-free.

### Phase D — later separate design cycle

Only after Phase 4 passes:

- Revisit upstream abstraction.
- Revisit typed core `Transport` use for pure message paths.
- Revisit ForwardEngine convergence.

Do not bundle Phase D with Pingora listener integration.

## Test matrix

Minimum commands for implementation validation:

```bash
cargo test -p core
cargo test -p core --features pingora-transport
cargo test -p router
cargo test -p router --features pingora-listener
cargo test --workspace
```

Additional guards:

```bash
grep -r "requestion\|session_update\|opencode\|permission\|question" crates/core/src/ \
  && echo "FAIL: core has business semantics" || echo "PASS: core clean"

cargo tree -p session-links | grep -E "tokio-tungstenite|pingora" \
  && echo "FAIL: session-links has network deps" || echo "PASS: session-links clean"
```

Runtime/integration checks should include:

- default listener Hello exchange;
- Pingora listener Hello exchange;
- route announcement and routed envelope through Pingora listener;
- observer tap JSON through Pingora sink;
- read permission denial and error response unchanged;
- rollback to default listener by config.

## Observability requirements

Add tracing around:

- selected listener backend;
- accept success/failure;
- WebSocket/Pingora handshake failure;
- Hello parse failure;
- role validation failure;
- peer register/unregister;
- frame parse failure after registration;
- writer send failure.

Do not log raw payload text by default.

Use consistent fields where possible:

- `router`
- `node_id`
- `peer`
- `peer_addr`
- `role`
- `backend`
- `error`

## Rollback plan

Rollback remains simple:

1. Switch runtime config back to default Tokio/Tungstenite listener.
2. If needed, build without `router/pingora-listener`.
3. If shared frame extraction regresses default behavior, revert Phase 1 separately.
4. No wire schema or persisted data migration is involved.

## Remaining disagreements needing user裁决

None for the immediate implementation path.

Open future topics, not current disagreements:

- Whether and when upstream outbound transport should be abstracted through core.
- Whether and when pure `LinkMessage` channels should directly use core typed `Transport`.
- Whether and how ForwardEngine convergence should happen after Pingora listener validation.
