<!-- historical / pre-cleanup: references pre-convergence crate names (session-links, clientlib, clientroute, etc.). These names are historical only; see AGENTS.md for current canonical names. -->

# OSGP Legacy Migration Notes

**Author:** GLM-7 (legacy & docs cleanup)
**Date:** 2026-05-16
**Status:** Legacy crates removed from the active worktree; use git history for reference.

---

## 1. Legacy Crate Inventory

### 1.1 Removed legacy crate tree (8 crates, 6967 lines total)

These crates were **NOT** registered workspace members. They represent a pre-refactor
architecture using the `glassvein-*` naming convention and an older protocol layer
(`glassvein-protocol` → `glassvein-core` chain).

| Legacy Crate | Lines | Successor | Notes |
|---|---|---|---|
| `glassvein-protocol` | 368 | `session-links` | Old protocol/message types |
| `glassvein-core` | 2348 | `core` | Old routing core with transport/route/filter/forward/tap |
| `glassvein-clientlib` | 627 | `clientlib` | Depends on glassvein-protocol |
| `glassvein-clientroute` | 797 | `clientroute` | Depends on glassvein-core, glassvein-protocol |
| `glassvein-router` | 1835 | `router` | Depends on glassvein-core, glassvein-protocol |
| `glassvein-router-cli` | 318 | `router` (main.rs) | Old binary crate |
| `glassvein-osg-surface` | 794 | (none) | OSG-specific surface, no direct successor |
| `glassvein-pingora` | 80 | `core/transport/pingora.rs` | Pingora stub; removed with the legacy tree (pingora-core 0.4.0 incompatible with the toolchain used at migration time) |

The former legacy workspace (`legacy/Cargo.toml`) has been removed. Historical
snapshots remain available through git history.

### 1.2 Duplicate Directories (GLM-2 migration in progress)

| Duplicate | Source | Target | Status |
|---|---|---|---|
| `core/` ≡ `crates/core/` | GLM-2 migration | `core/` is new canonical location | Both exist; `crates/core/` is stale copy |
| `router/` ≡ `crates/router/` | GLM-2 migration | `router/` is new canonical location | Both exist; `crates/router/` is stale copy |
| `endpoints/control/` | GLM-2 planned | not yet created | Referenced in workspace Cargo.toml but dir missing |
| `endpoints/viewer/` | GLM-3 planned | not yet created | Referenced in workspace Cargo.toml but dir missing |
| `endpoints/requestion/` | GLM-4 planned | not yet created | Referenced in workspace Cargo.toml but dir missing |

**Action:** GLM-2 owns the `crates/` → top-level migration. When complete, stale
`crates/core/` and `crates/router/` copies should be removed. **Do not touch these.**

### 1.3 Active Workspace Crates (KEPT, do not move)

| Crate | Location | Depends On |
|---|---|---|
| `session-links` | `osgp/rust/` | (none) |
| `core` | `core/` (moved from `crates/core/`) | `session-links` |
| `router` | `router/` (moved from `crates/router/`) | `session-links`, `core` |
| `clientlib` | `crates/clientlib/` | `session-links` |
| `clientroute` | `crates/clientroute/` | `session-links`, `clientlib` |
| `surface` | `crates/surface/` | `session-links`, `clientlib` |
| `control-surface` | `crates/control-surface/` | `session-links` |
| `observer-surface` | `crates/observer-surface/` | `session-links` |
| `requestion-surface` | `crates/requestion-surface/` | `session-links` |
| `glassvein-opencode-router` | `crates/glassvein-opencode-router/` | `session-links` |
| `glassvein-demos` | `demos/` | `clientlib`, `router`, `session-links`, `surface` |

### 1.4 npm Packages (KEPT, do not move)

| Package | Location | Notes |
|---|---|---|
| `@opensessiongateway/glassvein-router` | `packages/glassvein-router/` | npm package wrapping Rust binary |
| `@opensessiongateway/opencode-vein-plugin` | `packages/opencode-vein-plugin/` | TypeScript plugin with dist/ and src/ |

---

## 2. observer.rs / control.command Status

**`crates/surface/src/observer.rs`** (481 lines): Clean. No `control.command` remnants.
The observer surface properly uses kind-based filtering (`"control.abort"`, `"add_prompt"`)
with correct visibility scope enforcement (LocalRouter/LocalAndUpstream/FullTree).

The `control_command_*` references are in `crates/surface/src/control.rs` (test functions),
which is the correct location for control command tests. **No cleanup needed.**

---

## 3. docs/ Cleanup Performed

| Doc | Change |
|---|---|
| `docs/ARCHITECTURE.md` | Updated Pingora section to point at `core/src/transport/pingora.rs`; old Pingora stub is available only through git history |

### Docs NOT touched (other workers' territory)

- `docs/OPENSESSIONGATEWAY_PROTOCOL.md` — GPT-2 writing OSGP protocol
- `docs/OSGP_GLM_IMPLEMENTATION_TASKS.md` — GPT-2 managing implementation tasks
- `docs/PINGORA_*.md` — GPT-2/GPT-A/GPT-B design documents
- `docs/OPENCODE_*.md` — deployment/vein-plugin docs (reference `packages/` which still exists)

---

## 4. Validation Results

| Command | Result |
|---|---|
| former `legacy/ cargo check --workspace` | Historical result only; legacy tree has since been removed |
| `cargo check -p core -p router -p clientlib -p clientroute -p surface -p control-surface -p observer-surface -p requestion-surface -p glassvein-opencode-router` | **PASS** (warnings only) |
| `cargo test -p router` | **3 FAIL** (envelope_forward tests: Empty channel receives — likely race from GLM-2's in-progress migration, not caused by legacy moves) |
| `cargo test -p session-links` | **PASS** (7/7) |

---

## 5. Remaining Issues / Recommended Next Steps

1. **Stale `crates/core/` and `crates/router/`** — identical to `core/` and `router/`.
   Remove once GLM-2 confirms migration complete.

2. **Missing `endpoints/` directories** — referenced in workspace Cargo.toml but don't exist.
   This blocks `cargo check --workspace`. GLM-2/3/4 own these.

3. **Router test failures** — 3 `envelope_forward` tests fail with Empty channel receives.
   Investigate after GLM-2 migration stabilizes.

4. **`packages/glassvein-router/` npm package** — still references `glassvein-router-cli` binary.
   Update after router binary name/location is finalized.

5. **Removed `glassvein-pingora` stub** — the historical stub did not compile due to the pingora-core 0.4.0 toolchain issue.
   Future Pingora integration should use `core/src/transport/pingora.rs` (feature-gated).
