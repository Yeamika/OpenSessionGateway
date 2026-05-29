# Demo Router State

Demo state-file templates for the 4 routers in the multiprocess demo.

## Files

| File | Router | Manual Routes | Persistent Grants |
|------|--------|--------------|-------------------|
| [root-router.json](root-router.json) | root-router :7200 | 2 | 8 (console-endpoint) |
| [east-router.json](east-router.json) | east-router :7201 | 3 | 8 (alpha, delta, session-control, timer) |
| [west-router.json](west-router.json) | west-router :7202 | 3 | 8 (beta, requestion, mailbox) |
| [nested-router.json](nested-router.json) | nested-router :7203 | 3 | 6 (gamma, omega, im) |

## Serde Compatibility

These templates match the `RouterState` schema in `router/src/state_store/types.rs`:

- `schema_version`: integer (current: 1)
- `manual_routes[].address/neighbor/distance`: route entry fields
- `rules[]`: forward rules (empty in base templates)
- `persistent_grants[].op`: PermissionOp with `#[serde(rename_all = "snake_case")]`
  - Valid values: `announce_route`, `observe_session_update`, `read_runtime_session_messages`,
    `control_add_prompt`, `admin_routes_read`, `admin_routes_write`, `admin_rules_read`, `admin_rules_write`
- `persistent_grants[].kind`: ApprovalKind with `#[serde(rename_all = "snake_case")]`
  - Valid values: `persist`, `once`, `{"ttl": {"seconds": N}}`

## Constraints

- Endpoint processes do NOT read or modify these files. State-files are
  demo/operator artifacts only.
- Generated runtime state (learned routes, current peers) goes to `.tmp/`.
- No real credentials or production config in this folder.
