# Router Admin Plane — Design (MVP)

## Goal

Allow an admin endpoint (directly connected to a router) to manage runtime
route-table and rule-table entries through structured admin requests. The
router validates, applies, and audits all changes; the endpoint is just a
client UI.

## Scope (MVP)

- **Local-only**: admin endpoint connects to the same router via WebSocket,
  same as any other peer. No remote cross-topology admin.
- **No real auth yet**: capability/dry-run/revision/audit extension points
  are reserved but not enforced in MVP.
- **Core stays pure**: `core` crate owns `RouteTable` and `RuleTable` data
  structures and decision logic only. No transport, no router, no endpoint
  dependency.
- **Router holds runtime state**: admin requests arrive via the existing
  link-message path; router validates and applies them to the shared
  `RouteTable` / `RuleTable`.

## Layering

```
┌──────────────────────────────────────────────┐
│  endpoint (admin UI)                         │
│  sends admin LinkMessage / typed request     │
└──────────────┬───────────────────────────────┘
               │ WebSocket (same as any peer)
┌──────────────▼───────────────────────────────┐
│  router                                      │
│  ┌─ admin handler ──────────────────────┐    │
│  │  validate → apply → audit log        │    │
│  └──────────────┬───────────────────────┘    │
│                 │                             │
│  ┌──────────────▼───────────────────────┐    │
│  │  core::RouteTable  (shared RwLock)   │    │
│  │  core::RuleTable   (shared RwLock)   │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

## RouteTable enhancements (core)

### Route origin

Every `RouteEntry` now carries an `origin` field:

```rust
pub enum RouteOrigin {
    Learned,  // learned from neighbor Hello / Announce
    Manual,   // inserted by admin endpoint
}
```

`remove_neighbor` only removes `Learned` entries for that neighbor.
Manual routes survive peer disconnect.

### Semantic list

New methods on `RouteTable`:

- `list_all() -> Vec<RouteSnapshotEntry>` — all routes with origin.
- `list_by_neighbor(neighbor: &str) -> Vec<RouteSnapshotEntry>` — routes
  for a specific neighbor.
- `list_manual() -> Vec<RouteSnapshotEntry>` — only manual routes.

### Semantic remove

- `remove_manual(address: &SessionAddress, neighbor: &str) -> bool` —
  remove a specific manual route entry.

### Revision (reserved)

`RouteTable` carries a `revision: u64` counter, bumped on every mutation.
Returned in snapshots for optimistic concurrency (not enforced in MVP).

## RuleTable (core — new module)

A separate table of forwarding rules evaluated **before** route resolution.

### Rule structure

```rust
pub struct Rule {
    pub id: String,
    pub priority: u32,          // lower = evaluated first
    pub enabled: bool,
    pub matcher: RuleMatcher,
    pub action: RuleAction,
    pub revision: u64,          // reserved
}

pub struct RuleMatcher {
    pub source_address: Option<SessionAddress>,
    pub target_address: Option<SessionAddress>,
    pub link_type: Option<String>,     // "upload"|"control"|"request"|"response"
    pub subtype: Option<String>,
    pub kind: Option<String>,          // legacy kind field
    pub from_neighbor: Option<String>,
    pub ttl_min: Option<u8>,
    pub ttl_max: Option<u8>,
}

pub enum RuleAction {
    Drop { reason: String },
    ForceNeighbor { neighbor_id: String },
    DenyNeighbor { neighbor_id: String },
    Continue,  // no-op, allow next rule or route resolution
}
```

### Matching semantics

All matcher fields are `Option`. A `None` field means "match any". All
non-None fields must match (AND logic within one rule). First matching
rule wins (rules sorted by priority).

### RuleTable API

- `add_rule(rule: Rule)` — insert, sorted by priority.
- `remove_rule(id: &str) -> bool` — remove by ID.
- `enable_rule(id: &str) -> bool` / `disable_rule(id: &str) -> bool`.
- `list_rules() -> Vec<&Rule>` — all rules in priority order.
- `evaluate(ctx: &RuleContext) -> Option<RuleAction>` — first match wins.
- `revision() -> u64` — current revision counter.

### RuleContext

```rust
pub struct RuleContext<'a> {
    pub source: &'a SessionAddress,
    pub target: &'a SessionAddress,
    pub link_type: &'a str,
    pub subtype: &'a str,
    pub kind: &'a str,
    pub from_neighbor: Option<&'a str>,
    pub ttl: u8,
}
```

Built from an envelope + from_neighbor by the router layer.

## Router admin handler

### AdminRequest (wire type — MVP uses simple JSON)

```rust
pub enum AdminRequest {
    // Route management
    RouteList,
    RouteListByNeighbor { neighbor: String },
    RouteListManual,
    RouteAdd { address: SessionAddress, neighbor: String, distance: u32 },
    RouteRemove { address: SessionAddress, neighbor: String },

    // Rule management
    RuleList,
    RuleAdd { rule: Rule },
    RuleRemove { id: String },
    RuleEnable { id: String },
    RuleDisable { id: String },

    // Query
    Revision,
    DryRun { envelope: SessionEnvelope, from_neighbor: Option<String> },
}
```

### AdminResponse

```rust
pub enum AdminResponse {
    Ok { data: Value },
    Error { message: String },
}
```

### Handler location

`router/src/admin.rs` — a module that:

1. Accepts `AdminRequest` (parsed from a `LinkMessage` variant or typed
   envelope).
2. Validates the request (ownership, format).
3. Acquires the appropriate lock on `RouteTable` / `RuleTable`.
4. Performs the mutation.
5. Returns `AdminResponse`.
6. Emits audit `TapEvent` (extension point, MVP just logs).

## Wire path (MVP)

Admin requests use the existing `LinkMessage::Envelope` path with a
well-known `kind = "admin.request"` / `kind = "admin.response"`. The
router's `handle_message` detects admin envelopes and routes them to
the admin handler instead of the forward engine.

This avoids adding a new `LinkMessage` variant in MVP while keeping the
option open for a dedicated variant later.

## Testing strategy

- **Core unit tests**: `route/tests.rs` for origin-aware list/remove;
  new `rule/tests.rs` for matcher/action/priority.
- **Router unit tests**: `admin/tests.rs` for handler logic using
  `RouteTable` / `RuleTable` directly (no real WebSocket).
- No integration or network-dependent tests in MVP.

## Out of scope (MVP)

- Real authentication / capability enforcement.
- Remote admin across topology.
- Wire-level `AdminRequest` / `AdminResponse` as a `LinkMessage` variant.
- Dry-run enforcement (struct only, no execution).
- Audit persistence.
- Timer-based rule expiry.

---

# Stage 2 — Operator Shell, JSON Persistence, LinkHandshake, Permission Model

## LinkHandshake vNext (osgp)

### Design

New `LinkHandshake` struct replaces `HelloMessage` for new peers:

```rust
pub struct LinkHandshake {
    pub protocol_version: String,  // "osgp/1"
    pub peer_id: String,           // declared identity, not auth principal
    pub metadata: Option<Value>,   // opaque connection facts
}
```

Key differences from `HelloMessage`:
- No `role` field — role is not used for authorization.
- No `capabilities` field — permissions come from the rule/policy table.
- No `addresses` field — addresses are sent via independent `Announce` messages.

### Migration path

- `HelloMessage` and `Role` are marked `#[deprecated]` but kept for backward compatibility.
- `HandshakeKind` enum (`Link` / `Hello`, untagged) allows routers to parse either variant.
- Existing router code continues to use `HelloMessage` with `#[allow(deprecated)]`.
- New peers should send `LinkHandshake`.

## Permission / Policy request model (core)

### Design

Protocol-level operations abstracted from legacy business concepts:

```rust
pub enum PermissionOp {
    ObserveSessionUpdate,
    ReadRuntimeSessionMessages,
    ControlAddPrompt,
    AdminRoutesRead,
    AdminRoutesWrite,
    AdminRulesRead,
    AdminRulesWrite,
    AnnounceRoute,
}
```

Request lifecycle:
1. Peer requests an op → `PermissionRequest` created with `Pending` status.
2. Operator (via shell or admin handler) approves or denies.
3. Approved requests produce a `GrantRecord` with kind: `Once`, `Ttl { seconds }`, or `Persist`.

The `PermissionQueue` holds pending requests and active grants.

### Default policy direction

When no allow rule matches, generate a pending permission request. Operator
approve/deny then decides. Full wire enforcement is a future step.

## Router Operator Shell (router)

### Design

Local built-in command line (`--operator-shell` / `--admin-shell`).
Parses fixed commands only — no arbitrary system commands.

Commands:
- `help`, `peers`, `peer show <id>`
- `requests`, `approve <id> once|ttl=<secs>|persist`, `deny <id>`
- `routes`, `route add <addr> via <peer> dist <n>`, `route remove <addr> [via <peer>]`
- `rules`, `rule enable|disable|remove <id>`
- `dry-run ...` (placeholder), `tail` (placeholder), `quit`

The shell calls into `AdminHandler`, `RouteTable`, `RuleTable`, and
`PermissionQueue`. No second permission system.

## Local JSON state store (router)

### Design

`--state-file <path>` CLI flag. When set, the router persists state to a
JSON file.

Persisted content:
- `schema_version` (currently 1)
- `node_id`, `updated_at`
- `route_revision`, `rule_revision`, `permission_revision`
- `manual_routes` (learned routes excluded)
- `rules` (forward rules)
- `persistent_grants` (Once/Ttl grants excluded)
- `audit_log` (bounded)

Not persisted:
- Learned routes, current peers, temporary grants, real tokens/credentials.

Write requirements:
- Atomic (temp file + rename)
- Unix mode 0600
- Avoid high-frequency flush

## Test counts (stage 2 complete)

- osgp: 42 tests (5 new: LinkHandshake + HandshakeKind)
- core: 99 tests (20 new: PermissionQueue + PermissionOp)
- router: 114 tests (executor + admin + permission wiring + state store + shell)
- **Total: 255 tests, 0 failures**

## Runtime integration (rework)

### Admin request wire path

Admin requests use `LinkMessage::Envelope` with `kind = "admin.request"`.
`RouterNode::handle_message()` detects admin envelopes, parses the payload
as `AdminRequest`, calls `AdminHandler`, and sends the response back as
an envelope with `kind = "admin.response"`.

### Operator shell CLI

`--operator-shell` / `--admin-shell` flag starts an interactive shell
connected to the real `RouterNode`. Commands call `AdminHandler`,
`PermissionQueue`, and peer registry directly.

### State store CLI

`--state-file <path>` enables JSON persistence. On startup, loads manual
routes and persistent grants. On shutdown, saves current state atomically.
