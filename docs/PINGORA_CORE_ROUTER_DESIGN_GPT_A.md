<!-- historical / pre-cleanup: design debate document, paths may reference pre-migration layout -->
# GPT-A Round 1: core Pingora + router transport convergence design

## Thesis

Pingora should live **below** router business logic, not inside it. The migration goal is not to move read/permission/question semantics into `core`, but to make `core` the owner of the **transport/runtime adapter boundary** that can be driven by Pingora while router keeps ownership of peer lifecycle, Hello, dispatch, observer broadcast, and all cross-domain read-policy decisions.

The safe path is:

1. keep WebSocket as the only wire protocol;
2. let `core::transport::pingora` own Pingora-backed transport primitives;
3. let router introduce a narrow `LinkAcceptor` / `link_io` seam that can consume either tungstenite or Pingora frame sources;
4. move listener/accept onto the Pingora path only after the seam is proven;
5. postpone any `ForwardEngine` convergence until the listener/accept path is stable.

## Current fact pattern

Verified shape in code:

- `crates/core/src/transport/pingora.rs` already exposes a feature-gated Pingora transport adapter with raw frame APIs:
  - `send_text`
  - `recv_text`
  - `close_ws`
- `crates/router/src/connection/link_io.rs` already provides a transport-agnostic wire-frame seam.
- `crates/router/src/connection/pingora_listener.rs` exists as a stub/contract only.
- `crates/router` still uses the tungstenite listener path in `ConnectionManager::start_listener`.

So the design problem is not protocol invention; it is **where to draw the boundary so the next swap is local**.

## Boundary contract

### `core` may own

Allowed in `core`:

- transport abstractions (`Transport`, `TransportFactory`)
- Pingora-backed transport adapter
- raw frame send/recv/close
- generic route/next-hop/forward decision primitives
- TTL / trace / hop bookkeeping
- transport-neutral envelope forwarding decisions

### `core` must not own

Forbidden in `core`:

- `requestion`
- `session_update`
- `opencode`
- permission/question business semantics
- observer broadcast policy
- surface-specific visibility rules
- Hello handshake semantics beyond raw frame transit
- peer registry / lifecycle / connection orchestration

In short: `core` can move bytes and make forwarding decisions, but it must not decide *what the bytes mean* at the business layer.

### `router` must own

Router remains responsible for:

- peer lifecycle (`connect`, `register`, `unregister`, disconnect cleanup)
- Hello handshake
- dispatch of `LinkMessage`
- observer tap/broadcast
- read-request routing and authorization/policy checks
- route learning from announcements
- local error reply generation for failed reads/forwards
- selection of listener backend (tungstenite today, Pingora later)

This keeps Pingora as infrastructure, not as policy.

## Recommended architecture

### 1) Keep `link_io.rs` as the seam

`link_io.rs` is the right place to converge the two transport worlds because it already abstracts:

- `WireFrame`
- JSON encode/decode
- frame sink/reader traits
- generic writer loops

Recommended extension:

- keep `WireFrame` as the single router-visible wire unit
- add a Pingora-specific sink/reader adapter only in the router boundary layer, not in protocol logic
- reuse `send_text` / `recv_text` from `core::transport::pingora::PingoraTransport` as the raw frame API behind the adapter

This means the router can do:

`PingoraTransport::recv_text() -> WireFrame -> Hello/LinkMessage parse`

and later:

`Hello/LinkMessage -> WireFrame -> PingoraTransport::send_text()`

without changing dispatch logic.

### 2) Introduce a router-side Pingora acceptor, not a Pingora router rewrite

The listener swap should be implemented as an adapter layer in `router`, not by rewriting router logic around Pingora APIs.

Suggested shape:

- `core::transport::pingora` owns the Pingora transport object and raw frame API.
- `router::connection::pingora_listener` owns a `LinkAcceptor` implementation that wraps the Pingora transport factory.
- `ConnectionManager` consumes `dyn LinkAcceptor`.

This preserves one invariant: router code sees **accepted transports**, not Pingora server internals.

### 3) Make listener selection feature-driven

Default behavior:

- no feature flags: current tungstenite listener path remains active
- `pingora-transport` in core: enables the adapter type only
- `pingora-listener` in router: enables the acceptor seam and Pingora-backed listener path, but only when explicitly selected

Recommended phase progression:

- phase A: core adapter exists, router seam exists, tungstenite remains default
- phase B: router can compile both acceptors, but tungstenite still runs by default
- phase C: `RouterNode::start()` selects Pingora acceptor when feature/config requests it

### 4) Do not pull Pingora into surface/client crates

`clientlib`, `surface`, and requestion-style surfaces should remain Pingora-agnostic.

They should continue speaking WebSocket over the same `session-links` protocol, while router decides which server runtime accepted the connection.

## Phase plan

### Phase 0 — stabilize the seam

Goal: prove that Pingora transport can enter router without touching business semantics.

Deliverables:

- `core::transport::pingora` remains the source of raw WS frame I/O.
- `router::connection::link_io` is the only place that translates frames into typed messages.
- `pingora_listener` stays stubbed if the seam is not yet complete.

Acceptance:

- existing tungstenite flow still passes all tests
- Pingora transport tests compile with the feature gate

### Phase 1 — route listener accepts via Pingora transport factory

Goal: router downstream listener/accept path uses Pingora transport, but still hands the same router-level message flow into `ConnectionManager`.

Deliverables:

- `PingoraTransportFactory` accepted by router acceptor
- `PingoraLinkAcceptor` implements the listener contract
- `ConnectionManager` can start from either acceptor

Acceptance:

- Hello handshake still happens in router
- peer registration, dispatch, and observer tap remain unchanged
- no business logic migrates into core

### Phase 2 — controlled ForwardEngine convergence

Goal: centralize only the safe transport-neutral parts of forwarding.

What may converge into `core`:

- next-hop selection
- hop count / trace updates
- TTL enforcement
- generic forward decision objects

What must remain in router:

- read-request processing
- observer broadcast semantics
- cross-domain permission/question handling
- any routing of surface-specific control envelopes

Reason: these are not pure forwarding decisions; they depend on runtime roles and visibility policy.

### Phase 3 — optional long-term refactor

Only after Phase 1 is stable should `ForwardEngine` be considered for deeper extraction. Even then, it should be split into:

- a transport-neutral decision core
- a router-owned policy executor

Never a full migration of request semantics into `core`.

## Detailed mapping

### `core`

Owns:

- `PingoraTransport`
- `PingoraServerApp`
- `PingoraTransportFactory`
- raw frame methods
- generic transport trait

Does not own:

- router peer registry
- Hello parsing rules
- observer taps
- permission/read/question op semantics

### `router`

Owns:

- `ConnectionManager`
- `LinkAcceptor`
- `PingoraLinkAcceptor`
- `link_io.rs`
- `start_listener` selection logic
- `dispatch_message`

Does not own:

- Pingora server internals
- transport implementation details beyond adapter shape

## Test and acceptance matrix

### Unit-level

1. `core::transport::pingora` compiles with `pingora-transport` on/off.
2. raw frame API remains available and typed `Transport` delegation still works.
3. `link_io` round-trips `WireFrame` ↔ JSON `LinkMessage`.

### Router-level

1. tungstenite listener still accepts peers and passes Hello.
2. Pingora acceptor path compiles behind feature gate.
3. `ConnectionManager` can consume a mocked `LinkAcceptor`.
4. observer tap sees only local router events.

### Integration-level

1. Start router with default features: behavior unchanged.
2. Start router with Pingora feature: connection path still completes Hello and dispatch.
3. Broadcast/read flows remain unchanged across feature switches.

## Risks

### 1) Over-expanding `core`

If Pingora becomes a reason to move request/permission/question semantics into `core`, the boundary collapses and future policy bugs become harder to isolate.

Mitigation: keep `core` transport/decision only; all visibility and business policy stay in router.

### 2) Forcing a hard listener swap too early

Replacing the listener before `link_io` is stable would make debugging much harder.

Mitigation: keep Pingora as an acceptor adapter until the frame seam is proven.

### 3) Confusing raw frames with business messages

`send_text/recv_text` are transport-level primitives only. They must not be treated as a new protocol layer.

Mitigation: parse Hello and `LinkMessage` in router, not in `core`.

### 4) Feature-flag drift

If feature flags enable partial paths inconsistently, builds may succeed but runtime behavior may differ.

Mitigation: define one default path and one opt-in Pingora path; avoid multiple mixed defaults.

## Rollback strategy

Rollback must be trivial:

- disable `pingora-listener`
- keep `start_listener` on tungstenite
- retain `pingora-transport` only as a compile-time adapter feature
- leave router business logic untouched

This guarantees that a failed Pingora integration does not block the working WS demo path.

## What GPT-B should challenge

GPT-B should pressure-test these points:

1. Is `PingoraLinkAcceptor` the right seam, or should acceptor ownership live in a dedicated router runtime module?
2. Does `link_io.rs` need a separate Pingora reader/sink pair, or is the raw `PingoraTransport` API enough?
3. Which exact `ForwardEngine` pieces are truly transport-neutral and safe for core extraction?
4. Is the current feature split (`pingora-transport` vs `pingora-listener`) minimal enough, or does it need one more layer for runtime selection?
5. Can observer broadcast remain fully router-owned once Pingora is active, without hidden coupling to transport state?

## Bottom line

The correct migration is **adapter-first, policy-last**:

- core gets Pingora transport primitives;
- router gets a Pingora-backed acceptor seam;
- business semantics stay in router;
- `ForwardEngine` only converges later, and only for transport-neutral logic.
