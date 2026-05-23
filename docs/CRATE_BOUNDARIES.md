<!-- canonical: kept in sync with Cargo.toml workspace members -->
# GlassVein Rust Crate Boundaries

GlassVein is a standalone Rust/Cargo workspace. The architecture is not
required to preserve OSG compatibility.

## Crates

| Crate | Location | Role | May depend on |
| --- | --- | --- | --- |
| `osgp` | `osgp/rust/` | OSGP protocol primitives: address, envelope, wire/link message types. | external serde/json/uuid only |
| `osgp-client` | `clients/rust/` | Client SDK: API traits, identity, transport adapters. (was `clientlib` + `clientroute`) | `osgp` |
| `core` | `core/` | Pure routing table, route selection, TTL/trace policy, next-hop decisions. | `osgp` |
| `router` | `router/` | Router runtime composition around `core`; owns neighbor orchestration, not business semantics. | `osgp`, `core` |
| `surface` | `crates/surface/` | SDK library for building observer/control/query endpoint clients. Not a router role or wire concept. | `osgp`, `osgp-client` |

### Programs (binaries)

| Package | Location | Binary |
| --- | --- | --- |
| `control-endpoint` | `endpoints/control/` | `control-endpoint` |
| `surface-viewer` | `endpoints/viewer/` | `surface-viewer` |
| `requestion-endpoint` | `endpoints/requestion/` | `requestion-endpoint` |
| `glassvein-demos` | `demos/` | alpha-client, beta-client, gamma-client |

## Dependency direction

```text
osgp (osgp/rust)
├── core
│   └── router
└── osgp-client (clients/rust)
    └── surface
```

Rules:

- `osgp` is the root primitive crate and must not depend on workspace crates.
- `core` must stay transport- and business-agnostic.
- `router` depends on `core`, but `core` never depends on `router`.
- `osgp-client` provides client-facing contracts and transport adapters.
- `surface` is an SDK library for building endpoint clients; neither `core` nor `router` depends on it.
  It is not a wire/router role.
- npm packaging is only a distribution wrapper around built binaries; no npm publish step is part of this scaffold.

## Old → New name mapping

| Old name | New name | Status |
| --- | --- | --- |
| `session-links` | `osgp` | ✅ done |
| `clientlib` | merged into `osgp-client` | ✅ done |
| `clientroute` | merged into `osgp-client` | ✅ done |
| `control-surface` | `control-endpoint` | ✅ done |
| `observer-surface` | `surface-viewer` | ✅ done |
| `requestion-surface` | `requestion-endpoint` | ✅ done |

## Archived

Pre-refactor crates using the `glassvein-*` naming convention are archived in `legacy/crates/`
with their own workspace (`legacy/Cargo.toml`). See `docs/OSGP_LEGACY_MIGRATION_NOTES.md`.
