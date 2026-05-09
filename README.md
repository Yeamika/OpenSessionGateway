# GlassVein

GlassVein is an experimental hierarchical session routing core for OSG-style clients.

Current spike:

- Rust workspace at top-level `GlassVein/`.
- Pingora is cloned under `vendor/pingora` for evaluation.
- `examples/tree-demo` starts a tiny tree network and proves cross-node message forwarding.
- `examples/surface-demo` starts multiple routers, clients, and a surface endpoint, then verifies tree shortest-path routing.
- `examples/pingora-surface-demo` puts Pingora in front of every router ingress, then verifies the same shortest-path routing.
- `examples/multi-upstream-demo` verifies a router with two upstreams and multiple downstream clients/surfaces.

Target routing model:

```text
panel/client/router -> GlassVein router -> child router -> runtime/session
```

First demo topology:

```text
root router
└── child router
    └── leaf client/session
```

## Quick start

```bash
cd GlassVein
cargo build --workspace
cargo run -p glassvein-tree-demo
cargo run -p glassvein-surface-demo
cargo run -p glassvein-pingora-surface-demo
cargo run -p glassvein-multi-upstream-demo
```

Expected success line:

```text
GlassVein tree demo OK: panel received demo.reply from domain-a/runtime-leaf/session-leaf
GlassVein surface demo OK: all shortest-path probes passed
GlassVein Pingora surface demo OK: ingress + shortest-path probes passed
GlassVein multi-upstream demo OK: dual-router chose both upstreams and served local downstreams
```

## Shortest-path tree demo

`glassvein-surface-demo` uses this topology:

```text
root-router
├── east-router
│   ├── alpha-client
│   └── runtime-control-surface
└── west-router
    ├── beta-client
    └── nested-router
        └── gamma-client
```

The demo verifies these paths:

- same branch: `east-router`
- sibling branch: `east-router -> root-router -> west-router`
- nested local branch: `nested-router -> west-router`
- surface route: `west-router -> root-router -> east-router`

Routers exchange `RouteUpdate` announcements with hop distance, and the route table selects the lowest-distance next hop for the target address.

Route updates are exchanged bidirectionally between adjacent routers. The router uses split-horizon export when announcing to a neighbor, so routes learned from that neighbor are not sent back to it. Route updates are re-announced only when the table changes.

Routers also emit one-second forwarding counters:

```text
router forwarding speed router=east-router forwarded_per_sec=4 bytes_per_sec=2051 forwarded_total=4 dropped_total=0 peers=4 upstreams=1 route_entries=8
```

## Multi-upstream demo

`glassvein-multi-upstream-demo` uses this topology:

```text
root-a                 root-b
  ▲                      ▲
  │                      │
  └────── dual-router ───┘
          ├── dual-client
          └── dual-surface
```

All external connections enter through Pingora ingress ports. The demo verifies:

- `dual-router -> root-a` for a target under `root-a`
- `dual-router -> root-b` for a target under `root-b`
- `root-a -> dual-router -> root-b` for cross-root traffic
- `dual-router` local delivery for local surface traffic


## npm binary package

`packages/glassvein-router/` contains the npm wrapper for the `glassvein-router` binary. It packages only these binary targets:

- `win32-x64`
- `linux-x64`
- `linux-arm64`

Local CLI build/test:

```bash
cargo build --release -p glassvein-router-cli
./target/release/glassvein-router --help
```

## Pingora evaluation note

Pingora was cloned into `vendor/pingora` for evaluation.

- `cargo build --workspace` succeeds after installing `cmake`, `clang`, and `libclang-dev`.
- The Pingora example server was run successfully and its HTTP echo endpoint was probed.

This means Pingora is available for data-plane adapter work.

`glassvein-pingora-surface-demo` now uses Pingora as ingress/data-plane:

```text
client/surface/router upstream
  -> Pingora ingress
  -> GlassVein router internal listener
  -> GlassVein domain/runtime/session shortest-path routing
```

Pingora's `LoadBalancer<RoundRobin>` is used for ingress upstream selection. GlassVein still owns application-level domain/runtime/session shortest-path routing because Pingora does not know those address semantics.
