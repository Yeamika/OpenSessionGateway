# GlassVein

GlassVein is a standalone Rust/Cargo workspace for OSGP (OpenSessionGateway Protocol) routing architecture. It is not required to remain compatible with legacy OSG internals.

## Workspace layout

```text
osgp/rust/                          # osgp — OSGP protocol primitives
osgp/ts/                            # @opensessiongateway/osgp — TypeScript OSGP types
clients/rust/                       # osgp-client — Rust client SDK
core/                               # core — pure route table, TTL/trace, next-hop decisions
router/                             # router — runtime, neighbor orchestration, connection mgmt

endpoints/requestion/               # requestion-endpoint
endpoints/console/                  # console-endpoint
endpoints/session-control/          # session-control-endpoint
endpoints/mailbox/                  # mailbox-endpoint
endpoints/im/                       # im-endpoint
endpoints/timer/                    # timer-endpoint

crates/surface/                     # surface library (observer + control + query)

integrations/opencode/plugin/       # @opensessiongateway/opencode-vein-plugin (TypeScript)
packages/glassvein-router/          # npm wrapper for Rust router binary

demos/                              # demo binaries (alpha/beta/gamma-client)
examples/                           # OSGP endpoint examples (Rust + TypeScript)
legacy/                             # archived pre-refactor glassvein-* crates (not in workspace)
```

`endpoints/control/` and `endpoints/viewer/` are retired names; use
`endpoints/console/` for the active human console endpoint.

See [`docs/CRATE_BOUNDARIES.md`](docs/CRATE_BOUNDARIES.md) for dependency rules and [`docs/MULTI_NODE_PROGRAMS.md`](docs/MULTI_NODE_PROGRAMS.md) for commands.

## Local checks

```bash
cargo check -p osgp -p core -p router -p osgp-client -p surface
cargo test -p osgp -p router
```

No deployment, container, server, Verdaccio, or npm publish operation is part of this workspace scaffold.

Legacy `integrations/osg/plugins/` TypeScript OSG MCP plugins have been removed. Runtime-control, session-bridge, timer, and IM gateway behavior should live in Rust endpoints or runtime-provided MCP tools, not under the removed plugin tree.
