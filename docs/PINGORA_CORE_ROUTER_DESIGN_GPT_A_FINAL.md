<!-- historical / pre-cleanup: design debate document -->
# GPT-A Round 3 final unified design draft

## Status

GPT-A and GPT-B are now aligned on the architecture. The final design should use GPT-A's boundary thesis and GPT-B's more precise accepted-link seam.

No remaining technical disagreement needs user裁决 before implementation planning.

## Unified thesis

Use an **adapter-first, policy-last** migration:

- `core` owns the feature-gated Pingora WebSocket transport adapter and raw frame primitives.
- `router` owns peer lifecycle, Hello, dispatch, observer tap/broadcast, ReadRequest policy, error replies, route learning, and backend selection.
- Initial Pingora integration must bridge core `PingoraTransport::{send_text, recv_text, close_ws}` into router-local `link_io` frame I/O.
- Do not use `Box<dyn core::Transport>` as the initial router listener accepted object.
- Do not move business semantics or full `ForwardEngine` behavior into `core` during this phase.

## Agreed design points

### 1. Core boundary

`core` may own:

- `Transport` / `TransportFactory` traits.
- `PingoraTransport`, `PingoraServerApp`, `PingoraTransportFactory` behind `pingora-transport`.
- raw WebSocket frame API: `send_text`, `recv_text`, `close_ws`.
- typed `LinkMessage` transport convenience implementation.
- transport-neutral route table, TTL/trace, next-hop, and forward-decision primitives.

`core` must not own:

- `requestion`, `session_update`, `opencode`, `permission`, `question` semantics.
- Hello role semantics.
- peer registry or lifecycle.
- observer tap/broadcast policy.
- ReadRequest authorization or error reply construction.
- surface-specific visibility or reply routing.

### 2. Router boundary

`router` keeps:

- Hello parsing and role validation.
- peer registration/unregistration and route cleanup.
- dispatch of `LinkMessage` variants.
- observer local tap policy and tap-event JSON wire shape.
- ReadRequest/ReadResponse policy, permissions, and error replies.
- upstream reconnect/backoff policy.
- runtime backend selection.

### 3. `WireFrame` remains router-local

`WireFrame`, `FrameReader`, `FrameSink`, and router frame loops remain in `router::connection::link_io` or a router-local sibling module. They must not move to `core` in this phase.

Reason: Hello and observer tap frames are raw JSON frames but not typed `LinkMessage` values.

### 4. Accepted listener seam

The router acceptor must yield router frame I/O, not typed core transport.

Unified conceptual shape:

```text
LinkAcceptor::accept() -> Result<Option<AcceptedLink>>

AcceptedLink {
    peer_addr: String,
    reader: Box<dyn FrameReader + Send>,
    sink: Box<dyn FrameSink + Send>,
}
```

An equivalent single `FrameIo` object is acceptable if it better fits object-safety or ownership constraints.

### 5. Shared incoming-link handler

Extract the current post-WebSocket-accept logic into a shared router method over frame I/O:

```text
handle_incoming_link(peer_addr, reader, sink)
```

It performs the existing router sequence:

1. read Hello frame;
2. parse `HelloMessage`;
3. validate role;
4. send Hello reply;
5. register peer;
6. subscribe observer to local tap if applicable;
7. spawn plain/observer writer loop;
8. parse incoming `LinkMessage` frames and dispatch;
9. cleanup peer and routes on disconnect.

Both backends call the same handler:

```text
Tokio TcpListener -> tokio-tungstenite accept -> TungsteniteFrameReader/Sink -> handle_incoming_link
PingoraTransportFactory -> PingoraFrameReader/Sink -> handle_incoming_link
```

### 6. Pingora frame adapter

Behind `router/pingora-listener`, add router-local Pingora frame adapter(s):

```text
PingoraTransport::recv_text() -> WireFrame::from_text(...)
WireFrame::as_text() -> PingoraTransport::send_text(...)
close -> PingoraTransport::close_ws()
```

JSON parsing remains in router. Core raw frame APIs remain transport primitives only.

### 7. Feature and config separation

Cargo features only compile optional code. Runtime config selects behavior.

Required behavior:

- without `router/pingora-listener`: default tokio-tungstenite listener only;
- with `router/pingora-listener` but default config: still tokio-tungstenite listener;
- with feature plus explicit Pingora listener config: inbound downstream listener uses the Pingora accept path;
- config requesting Pingora without the feature should fail clearly.

### 8. Upstream remains unchanged for this phase

Router upstream outbound connection remains `tokio_tungstenite::connect_async` during the initial Pingora listener integration.

Reason: the current user goal is downstream listener/accept entering the core Pingora transport path. Upstream connect unification is separate and later.

### 9. ForwardEngine convergence is deferred

No immediate ForwardEngine convergence belongs in the Pingora listener integration phase.

ForwardEngine work becomes a later separate design cycle after inbound Pingora listener validation passes. Even then, only transport-neutral next-hop/TTL/trace/decision primitives may move toward core; read policy, observer tap, permission/question handling, and error replies remain router-owned.

## Final phase plan

### Phase 0 — design lock

- Accept this unified design.
- Freeze core/router boundaries.
- Keep all current runtime behavior unchanged.

### Phase 1 — frame seam extraction validation

- Preserve existing `link_io.rs` trait style unless a concrete implementation problem requires changing it.
- Extract or confirm `handle_incoming_link(peer_addr, reader, sink)` over router frame I/O.
- Route the default tokio-tungstenite listener through this shared handler.
- No Pingora runtime behavior yet.

### Phase 2 — Pingora frame adapter

- Add cfg-gated Pingora frame adapter using `PingoraTransport` raw APIs.
- Compile/test behind `router/pingora-listener`.
- Keep default behavior unchanged.

### Phase 3 — PingoraLinkAcceptor and explicit backend selection

- Implement `PingoraLinkAcceptor` wrapping `PingoraTransportFactory`.
- It returns `AcceptedLink` / frame I/O, not `Box<dyn core::Transport>`.
- Add explicit backend selection to router config.
- `RouterNode::start()` selects Pingora only when feature and config both request it.

### Phase 4 — validation hardening

- Validate default and Pingora paths.
- Add tracing for backend selection, accept failures, Hello failures, peer lifecycle, frame parse failures, and writer failures.
- Keep rollback to default listener trivial.

### Phase D — later ForwardEngine design

- Separate design cycle only after Phase 3/4 PASS.
- No business semantics into core.

## Acceptance / test matrix

Minimum checks for implementation:

- `cargo test -p core`
- `cargo test -p core --features pingora-transport`
- `cargo test -p router`
- `cargo test -p router --features pingora-listener`
- default config unchanged with and without `pingora-listener` feature;
- feature enabled but default config does not start Pingora;
- config requests Pingora without feature fails clearly;
- Pingora raw frame path completes Hello;
- invalid Hello / invalid role / closed-before-Hello does not register peer;
- observer tap remains local and router-owned;
- observer tap JSON can be sent through Pingora frame sink;
- ReadRequest permissions and error replies are unchanged;
- core business-semantics grep remains clean;
- `session-links` remains free of Pingora/tokio-tungstenite network dependencies.

## Rollback strategy

Rollback remains config-first:

1. switch listener backend to default tokio-tungstenite;
2. if needed, compile without `router/pingora-listener`;
3. because the shared handler is also used by the default listener, keep default path fully test-covered;
4. if the seam extraction itself regresses behavior, revert Phase 1 independently.

## Remaining disagreements

None.

The only implementation flexibility left is mechanical, not architectural:

- `AcceptedLink` may hold split `reader`/`sink` boxes or a single `FrameIo` object.
- Existing `link_io.rs` boxed-future trait style should be preserved unless implementation constraints require an equivalent adjustment.

These do not require user裁决.

## Ready for implementation

Yes, after Manager converts this unified design into an implementation task list for GLM/design-execution workers.
