<!-- historical / pre-cleanup: design debate document, paths may reference pre-migration layout -->
# Pingora core-router transport design (GPT-B Round 1)

## Scope and thesis

This document proposes the lowest-risk path for making the router enter through the existing core Pingora WebSocket transport path.

**Thesis:** do not move router forwarding or connection semantics into `core`, and do not converge everything into `ForwardEngine` now. Treat `core::transport::pingora::PingoraTransport` as a WebSocket frame provider and build a narrow router-owned adapter bridge at the existing `connection/link_io.rs` seam. The first shippable milestone should make inbound Pingora-accepted connections exercise the same Hello, registration, writer, dispatch, tap, and route-learning paths as the current Tokio/Tungstenite listener, with the default listener unchanged.

The reason is practical: router already has a good seam around `WireFrame`, and core already exposes raw text APIs (`send_text`, `recv_text`, `close_ws`) precisely for pre-`LinkMessage` handshake. Bridging those two surfaces avoids reworking `ReadRequest`, observer broadcast, permission/error replies, upstream reconnect, and peer lifecycle all at once.

## Verified current state

Observed code facts:

- `crates/core/src/transport/pingora.rs` is feature-gated behind `gv-core/pingora-transport`.
- `PingoraTransport` implements core `Transport` over `LinkMessage`, and also exposes raw WebSocket text operations:
  - `send_text`
  - `recv_text`
  - `close_ws`
- `PingoraServerApp::new(node_id)` returns `(PingoraServerApp, PingoraTransportFactory)` and pushes accepted WebSocket transports through a channel.
- Router has `crates/router/src/connection/link_io.rs`, which already defines:
  - `WireFrame`
  - serialize/deserialize helpers for `LinkMessage`
  - generic writer loops over `FrameSink`
  - Tungstenite reader/sink adapters
- Router has `connection/pingora_listener.rs` behind `pingora-listener`, but it is only a contract/stub.
- Router currently accepts inbound downstream connections in `ConnectionManager::start_listener()` via `tokio::net::TcpListener` + `tokio_tungstenite::accept_async`, then calls `handle_incoming_connection()`.
- Router currently connects upstream via `tokio_tungstenite::connect_async`; this is independent from inbound Pingora accept.
- Router business boundaries are real and should not be moved into core: `ReadRequest`, `ReadResponse`, role-based read permission, observer tap broadcast, direct surface reply routing, route learning callbacks, and error replies live in router modules.

## Boundary decisions

### Core boundary

Core may own or expose only transport-neutral and routing-core primitives:

Allowed in core:

- `Transport` and `TransportFactory` traits.
- Concrete Pingora WebSocket adapter, feature-gated.
- Raw WebSocket text frame send/receive for connection-level handshakes.
- Typed `LinkMessage` send/receive convenience implementation.
- Route table, TTL/trace mutation rules, next-hop decision, forward plan/metrics.
- Transport maps keyed by neighbor/node id.

Not allowed in core:

- Router Hello role semantics (`Client`, `Router`, `ControlSurface`, `ObserverSurface`).
- Peer registry, upstream registry, reconnect loops, split listener lifecycle.
- Observer tap subscription rules or broadcast of local router events.
- Read-operation authorization, `PermissionDenied`, or error-reply construction.
- Business payload interpretation (`question`, `permission`, session update, add prompt, workspace/session listing).
- Surface-specific reply routing or fallback behavior.
- Any dependency on `router`, `clientlib`, `surface`, or operational deployment concerns.

Important correction to current comments: `core/src/lib.rs` says core owns tap events and forward engine; the project `AGENTS.md` says core is route table / TTL / trace / next-hop only and no business semantics. For this design, the stricter project boundary wins: core Pingora transport is acceptable as a gated adapter, but router runtime semantics stay out.

### Router boundary

Router must keep:

- WebSocket Hello handshake and role parsing.
- Peer registration/unregistration and per-peer route cleanup.
- Route learning from Hello and `Announce`.
- Upstream connection policy and reconnect/backoff.
- Dispatch of `LinkMessage` variants to envelope forwarding and read forwarding.
- Observer/local tap policy and tap-event wire format.
- Read request authorization, error replies, and response routing.
- Operational config selection between default Tokio listener and optional Pingora listener.

Router should treat core Pingora transport as an I/O substrate, not as a router runtime replacement.

## Direct core `Transport` vs adapter bridge

Recommendation: **start with an adapter bridge, not direct `Transport` adoption.**

Directly using `core::Transport` in router peer loops is tempting, but it would erase a useful distinction:

- Router needs raw JSON frames before the typed `LinkMessage` loop because Hello is not a `LinkMessage`.
- Observer peers can receive local `tap_event` JSON frames that are also not `LinkMessage`.
- `core::Transport::recv()` intentionally parses only `LinkMessage` and skips invalid/non-typed frames; that is wrong for Hello and tap-event-bearing streams.

So the initial integration should bridge `PingoraTransport` to router `WireFrame` operations:

```text
PingoraServerApp / PingoraTransportFactory
        │
        ▼
PingoraTransport (core, raw text API)
        │ adapter bridge
        ▼
router::connection::link_io::{FrameReader, FrameSink, WireFrame}
        │
        ▼
existing router Hello + register + writer + dispatch loops
```

After this works, selected router paths can optionally accept `dyn Transport` for pure `LinkMessage` channels. That should be a later cleanup, not the first migration.

## Is `link_io.rs` the right seam?

Yes, with one small refinement.

`link_io.rs` is the correct seam because it already separates router domain logic from concrete WebSocket frame types. It is close enough to the wire to support Pingora raw frames, but high enough to keep router semantics unchanged.

Needed refinement:

- Add a generic async reader/sink abstraction for router frames if it is not already formalized enough.
  - Current writer side has `FrameSink` and generic writer loops.
  - The reader side is currently Tungstenite-specific (`TungsteniteFrameReader` with `next_text_frame`).
  - Add a router-owned `FrameReader` trait or equivalent small adapter type with `next_text_frame() -> Result<Option<WireFrame>>` semantics.
- Implement:
  - `TungsteniteFrameReader` for existing path.
  - `PingoraFrameIo` or `PingoraFrameReader`/`PingoraFrameSink` wrapping `PingoraTransport` raw text methods.

Do not move `WireFrame` to core yet. It includes router-only use cases such as Hello and tap JSON. Moving it would invite core to learn about router protocol details.

## Proposed architecture

### 1. Router-owned accepted link abstraction

Introduce a router-local abstraction, likely in `connection/link_io.rs` or a small sibling module:

```rust
#[async_trait]
pub trait FrameReader: Send {
    async fn next_text_frame(&mut self) -> anyhow::Result<Option<WireFrame>>;
}

#[async_trait]
pub trait FrameSink: Send {
    async fn send_frame(&mut self, frame: WireFrame) -> anyhow::Result<()>;
    async fn close(&mut self) -> anyhow::Result<()> { Ok(()) }
}
```

If the existing `FrameSink` already has a different exact shape, preserve it and only add the missing reader trait.

### 2. Split router handshake from concrete stream type

Refactor without semantic change:

- Keep current `handle_incoming_connection<S>()` for default Tokio/Tungstenite listener.
- Extract the shared body into a method like:

```text
handle_incoming_link(peer_addr, reader, sink)
```

That method performs the existing steps:

1. read Hello `WireFrame`;
2. parse `HelloMessage`;
3. validate role;
4. send Hello reply;
5. register `PeerHandle` backed by mpsc writer channel;
6. optionally subscribe observer to tap;
7. spawn existing plain/observer writer loop;
8. read frames, parse `LinkMessage`, dispatch;
9. cleanup peer and abort writer on disconnect.

The current Tungstenite path becomes only:

```text
TCP accept -> tungstenite accept_async -> split_tungstenite_ws -> handle_incoming_link
```

The Pingora path becomes:

```text
Pingora factory accept -> PingoraFrameIo -> handle_incoming_link
```

### 3. Implement `PingoraLinkAcceptor` as a bridge

Fill the current stub only when `router/pingora-listener` is enabled:

- It wraps `gv_core::transport::pingora::PingoraTransportFactory` or directly holds the receiver/factory returned by core.
- Its `accept()` yields a router frame I/O object, not only `Box<dyn Transport>`, because router needs raw frames.
- If preserving the existing stub trait is valuable, revise the trait from `Box<dyn Transport>` to a router-owned accepted connection:

```text
LinkAcceptor::accept() -> Result<Option<AcceptedLink>>
AcceptedLink { peer_addr: String, io: PingoraFrameIo }
```

Using `Box<dyn Transport>` here is too narrow for Hello/tap frames and would force either fake `LinkMessage` handshakes or duplicate parsing paths.

### 4. Add `start_listener_with_acceptor`

Add a generic listener runner:

```text
ConnectionManager::start_listener_with_acceptor(acceptor) -> bound/listener description
```

This method loops over accepted links and spawns `handle_incoming_link()`.

Keep `start_listener()` as the default current Tokio listener. This minimizes blast radius and provides immediate rollback.

### 5. Config selection

Extend `RouterConfig` later with an explicit listener backend, for example:

```text
ListenerBackend::TokioTungstenite   // default
ListenerBackend::Pingora            // only available with feature
```

Do not make `pingora-listener` automatically change runtime behavior just because the feature is compiled. Feature flags should enable code; config should select behavior.

## Feature flags and default behavior

Recommended flags:

- `gv-core/default = []` unchanged.
- `gv-core/pingora-transport` unchanged for Pingora dependencies and adapter.
- `router/default = []` unchanged.
- `router/pingora-listener = ["gv-core/pingora-transport"]` unchanged in dependency direction.

Behavior:

- Without `router/pingora-listener`: exactly current Tokio/Tungstenite listener and upstream behavior.
- With `router/pingora-listener` but no config selection: still current behavior.
- With feature + explicit Pingora listener config: inbound downstream listener uses Pingora accept, then router bridge.
- Upstream outbound connection remains `tokio_tungstenite::connect_async` in the first Pingora integration phase. Unifying outbound connect can be a later phase because the user requirement is server/core Pingora path and router listener/accept integration.

This avoids a surprising production behavior change from a build flag alone.

## Proposed phases

### Phase 0: Document and freeze boundaries

Deliver this design and agree on one invariant: core Pingora owns transport I/O, router owns router protocol and business routing semantics.

No code behavior changes.

### Phase 1: Generalize `link_io` reader seam

Goal: compile-only refactor; existing tests pass.

- Add or formalize `FrameReader`.
- Extract `handle_incoming_link()` from `handle_incoming_connection()`.
- Keep Tokio/Tungstenite path behavior identical.
- Add tests around Hello parsing/registration using a fake frame I/O if practical.

Validation:

- `cargo test -p router`
- Existing end-to-end listener tests still pass.

Rollback:

- Revert the extraction only; no external API must change.

### Phase 2: Implement Pingora frame bridge

Goal: bridge core `PingoraTransport` raw text methods into router `WireFrame` I/O.

- Add `PingoraFrameIo` behind `router/pingora-listener`.
- Implement send by `send_text(frame.as_text())`.
- Implement receive by `recv_text().await?.map(WireFrame::from_text)`.
- Implement close by `close_ws()`.
- Preserve JSON parsing in router, not core.

Validation:

- Unit test bridge with a mock trait if direct Pingora construction is hard.
- Compile test: `cargo test -p router --features pingora-listener --no-run`.
- If Pingora can run in process without external deployment, add an ignored or feature-gated integration test later.

Rollback:

- Disable `pingora-listener` or remove config selection; default listener unaffected.

### Phase 3: Wire Pingora listener accept loop

Goal: first functional inbound Pingora path.

- Implement `PingoraLinkAcceptor` wrapping `PingoraTransportFactory`.
- Add `ConnectionManager::start_listener_with_acceptor()`.
- Add `RouterConfig` backend selector.
- `RouterNode::start()` chooses default or Pingora path based on config and feature.

Validation:

- With default config: all old router tests pass.
- With Pingora config + feature: listener starts and accepts a WebSocket client that sends Hello and receives Hello reply.
- Verify a client can send `Announce` and a routed envelope via the Pingora listener path.

Rollback:

- Runtime config returns to default listener.
- Feature can remain compiled but unused.

### Phase 4: Optional upstream/client connect unification

Only after inbound Pingora path is stable:

- Decide whether outbound router-to-upstream connections need a core transport factory.
- If needed, add a client-side WebSocket transport in core or router adapter.
- Keep reconnect/backoff in router.

This phase is optional and should not block the user requirement that router accept/listener path enters core Pingora transport.

### Phase 5: Optional ForwardEngine convergence

Not now.

Only consider if envelope forwarding, typed forwarding, read forwarding, and tap/error observability can be represented as policy hooks without core learning business semantics. Until then, `ForwardEngine` convergence is higher-risk than the transport integration.

## Testing strategy

### Compile matrix

- `cargo test -p gv-core`
- `cargo test -p gv-core --features pingora-transport`
- `cargo test -p router`
- `cargo test -p router --features pingora-listener`

### Unit tests

- `WireFrame` roundtrips remain unchanged.
- `FrameReader` fake feeds Hello then LinkMessage frames to `handle_incoming_link()`.
- Observer writer still emits `tap_event` JSON and does not require `LinkMessage` parsing.
- Invalid Hello and invalid role fail before peer registration.
- Invalid `LinkMessage` after registration logs/skips without disconnecting unless current behavior says otherwise.

### Integration tests

First with existing Tokio listener:

- downstream client connects, Hello exchange works;
- route announcement learns route;
- envelope forwards;
- observer receives local tap only;
- read permission denial returns response.

Then with Pingora listener enabled:

- same behavioral tests, selected subset at first;
- especially test Hello over `PingoraTransport::recv_text/send_text`, because this is the reason to avoid direct `Transport::recv()`.

### Negative tests

- Feature enabled but config default: no Pingora runtime is started.
- Config requests Pingora without feature: clear compile-time or config error.
- Pingora accept returns closed connection before Hello: no peer remains registered.
- Writer channel closed: transport closes and peer cleanup runs.

## Observability

Minimum useful telemetry:

- Listener backend selected: `tokio-tungstenite` or `pingora`.
- Accept success/failure count with peer address if available.
- WebSocket handshake failure count.
- Hello parse/role validation failure count.
- Peer registered/unregistered with role and announced address count.
- Frame parse failure count after registration.
- Writer send failure count.
- Existing tap events remain router-local and must not be emitted by core.

Use existing `tracing` fields consistently:

- `router`
- `node_id`
- `peer`
- `peer_addr`
- `role`
- `backend`
- `error`

Avoid logging raw payload text by default; it may contain user/session content.

## Risk analysis

### Risk: using `core::Transport` directly loses non-`LinkMessage` frames

Impact: Hello cannot be parsed cleanly; tap events do not fit; invalid frames may be silently skipped.

Mitigation: bridge raw text APIs to router `WireFrame` first.

### Risk: accepting through Pingora changes connection lifecycle semantics

Impact: cleanup, writer aborts, and route removal may diverge from current listener.

Mitigation: use the same extracted `handle_incoming_link()` for both listener backends.

### Risk: feature flag changes production behavior unexpectedly

Impact: users compile with feature and accidentally start Pingora path.

Mitigation: feature only compiles code; config selects backend.

### Risk: Pingora `peer_addr` currently appears pointer-derived

Impact: weak diagnostics and observability.

Mitigation: treat peer address as best-effort in Phase 2; improve later if Pingora exposes remote address. Do not block transport integration on perfect peer address.

### Risk: core boundary drift

Impact: router business semantics leak into core during adapter work.

Mitigation: keep `WireFrame`, Hello, roles, read permission, tap, and reply routing in router.

### Risk: full `ForwardEngine` convergence distracts from transport goal

Impact: large refactor, high regression surface.

Mitigation: explicitly defer to optional Phase 5.

## Rollback plan

Rollback is config-first:

1. Switch listener backend to default Tokio/Tungstenite.
2. If necessary, compile without `router/pingora-listener`.
3. Since shared behavior remains in router `handle_incoming_link()`, default path remains test-covered.
4. If the shared extraction itself regresses behavior, revert Phase 1 independently before touching core Pingora code.

No persisted data format or public wire schema needs to change for this plan.

## What GPT-A should challenge

- Whether `LinkAcceptor` should yield router `AcceptedLink` frame I/O instead of `Box<dyn core::Transport>`; I believe `Box<dyn Transport>` is too narrow for Hello/tap frames.
- Whether `WireFrame` should remain router-local; I believe moving it to core would blur boundaries.
- Whether Pingora should become default behavior when feature is enabled; I believe explicit config is safer.
- Whether upstream outbound should be unified immediately; I believe delaying it reduces risk and still satisfies the listener/accept transport path requirement.
- Whether current core `PingoraTransport` should expose a split reader/writer API; I believe not required for the first bridge, but it may become useful if lock contention or read/write concurrency becomes a measured issue.
- Whether the existing `core::ForwardEngine` should absorb router forwarding now; I believe this is premature because read forwarding, tap, permissions, and error replies are router policy.
