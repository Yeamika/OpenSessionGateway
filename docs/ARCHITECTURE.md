<!-- canonical: GlassVein routing architecture overview -->
# GlassVein Architecture Spike

GlassVein core should own routing decisions, not session business semantics.

Core concepts:

- `RouteAddress`: domain/runtime/session address.
- `RouteAnnouncement`: address advertisement with hop distance.
- `RouteEnvelope`: opaque payload with source/target/ttl/trace.
- `ForwardAction`: local delivery, upstream forwarding, child forwarding, drop/reject.
- Router nodes may connect to multiple upstreams and multiple downstream clients/routers.
- `Surface` nodes are routable endpoints just like clients/panels; router core does not need to know the surface business semantics.

Tree routing rule:

- Directly attached nodes announce distance `0`; the receiving router stores them at distance `1`.
- Routers re-announce their best known routes to adjacent routers when the table changes.
- Announcements use split horizon: routes learned from a neighbor are not announced back to that neighbor.
- When forwarding, a router picks the lowest-distance next hop for the target address.
- If a route is unknown locally, a non-root router falls back to one connected upstream.
- `RouteEnvelope.route_hops` records the routers traversed by a message and is used by demos to verify shortest paths.
- Each router keeps lightweight forwarding counters and logs one-second speed samples: forwarded envelopes/sec, bytes/sec, cumulative forwarded bytes, drops, connected peers/upstreams, and route entry count.

Multi-upstream behavior:

- `RouterConfig.upstream_urls` can contain multiple upstream router ingress URLs.
- Each upstream is represented as an independent `NextHop::Upstream(upstream_id)`.
- If a router learns different targets from different upstreams, shortest-path selection chooses the upstream whose advertised distance is lowest.
- `examples/multi-upstream-demo/` verifies that a single `dual-router` forwards to both `root-a` and `root-b`, while still serving local downstream clients/surfaces directly.

The base demos intentionally use plain WebSocket + JSON to match current OSG technology.

Pingora integration:

- `core/src/transport/pingora.rs` provides a Pingora ingress adapter (feature-gated behind `pingora-transport`).
- The adapter uses Pingora `LoadBalancer<RoundRobin>` to select an upstream GlassVein router listener for each incoming HTTP/WebSocket connection.
- Pingora is the connection/data-plane router; GlassVein remains the application-level route resolver for `domain/runtime/session` addresses.
- Legacy Pingora stub (`legacy/crates/glassvein-pingora/`) retained for reference only; pingora-core 0.4.0 does not compile on the current toolchain.
