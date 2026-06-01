# Demo Address Map

## Address Format

OSGP session addresses use the format: `<domain>/<runtime-id>/<session-id>`

The first segment is the routing domain (determines inter-router forwarding).
The second segment is the runtime identifier (client/endpoint identity).
The third segment is the session identifier.

## Business Session Addresses (8)

These are the addresses announced by `bash-clientdummy` instances.

| # | Address | Client | Connects To | Notes |
|---|---------|--------|------------|-------|
| 1 | `east/runtime-alpha/session-alpha-1` | alpha-client | east-router | |
| 2 | `east/runtime-alpha/session-alpha-2` | alpha-client | east-router | Same runtime, second session |
| 3 | `east/runtime-delta/session-delta-1` | delta-client | east-router | |
| 4 | `west/runtime-beta/session-beta-1` | beta-client | west-router | |
| 5 | `west/runtime-beta/session-beta-2` | beta-client | west-router | Same runtime, second session |
| 6 | `nested/runtime-gamma/session-gamma-1` | gamma-client | nested-router | |
| 7 | `nested/runtime-gamma/session-gamma-2` | gamma-client | nested-router | Same runtime, second session |
| 8 | `nested/runtime-omega/session-omega-1` | omega-client | nested-router | |

### Domain Prefix Rationale

- `east/*` — sessions behind east-router
- `west/*` — sessions behind west-router
- `nested/*` — sessions behind nested-router (depth 2 from root)

The domain prefix matches the router subtree, enabling efficient wildcard
manual routes on inter-router links.

## Service Endpoint Addresses (6)

These are addresses announced by service endpoints at connect time.

| # | Address | Endpoint | Connects To | Notes |
|---|---------|----------|------------|-------|
| 1 | `domain-a/console-runtime/console` | console-endpoint | root-router | Uses `domain-a` (not a router subtree) |
| 2 | `surface/session-control-endpoint/*` | session-control-endpoint | east-router | Wildcard session for MCP bridge |
| 3 | `domain-a/timer-endpoint/timer` | timer-endpoint | east-router | |
| 4 | `west/requestion-endpoint/requestion-endpoint` | requestion-endpoint | west-router | Uses `west` prefix (co-located) |
| 5 | `domain-a/mailbox-endpoint/mailbox` | mailbox-endpoint | west-router | |
| 6 | `domain-a/im-endpoint/session` | im-endpoint | nested-router | IM gateway primary |

### Domain Prefix Rationale for Endpoints

- `domain-a/*` — cross-cutting service addresses not tied to a router subtree.
  These require manual routes on routers that don't directly host the endpoint.
- `surface/*` — session-control uses a surface namespace for its wildcard bridge.
- `west/*` — requestion-endpoint uses its local router's prefix for direct reachability.

## Full Address Table (14 unique addresses)

```text
Business sessions (8):
  east/runtime-alpha/session-alpha-1
  east/runtime-alpha/session-alpha-2
  east/runtime-delta/session-delta-1
  west/runtime-beta/session-beta-1
  west/runtime-beta/session-beta-2
  nested/runtime-gamma/session-gamma-1
  nested/runtime-gamma/session-gamma-2
  nested/runtime-omega/session-omega-1

Service endpoints (6):
  domain-a/console-runtime/console
  surface/session-control-endpoint/*
  domain-a/timer-endpoint/timer
  west/requestion-endpoint/requestion-endpoint
  domain-a/mailbox-endpoint/mailbox
  domain-a/im-endpoint/session
```

## Cross-Router Reachability

For a message from `nested/runtime-gamma/session-gamma-1` to reach
`domain-a/console-runtime/console`:

1. gamma-client → nested-router (local, announce-learned route)
2. nested-router → west-router (manual route: `domain-a/*` → west-router)
3. west-router → root-router (manual route: `domain-a/*` → root-router)
4. root-router → console-endpoint (announce-learned route)

Total hop count: 4 (nested → west → root → endpoint).
