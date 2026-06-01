# Route Analysis: Manual vs Announce-Learned

## Principle

- **Manual routes**: Inter-router backbone paths. These are pre-configured in the
  router state-file and define how traffic flows between router subtrees.
- **Announce-learned routes**: Client and endpoint session addresses. These are
  announced by the connecting peer at WebSocket handshake time via the
  `announce_route` permission.
- **Endpoints never modify router state-file**. The demo state-file is an
  operator/demo artifact only.

## Manual Routes by Router

### root-router

| Address Pattern | Neighbor | Distance | Purpose |
|----------------|----------|----------|---------|
| `east/*` | east-router | 1 | Forward all east-prefixed traffic to east-router |
| `west/*` | west-router | 1 | Forward all west-prefixed traffic to west-router |

Note: `nested/*` is NOT needed on root because nested-router is behind
west-router. West-router handles the `nested/*` → nested-router forwarding.
Messages from root to nested addresses go root → west → nested via the
`west/*` manual route on root and the `nested/*` manual route on west.

### east-router

| Address Pattern | Neighbor | Distance | Purpose |
|----------------|----------|----------|---------|
| `domain-a/*` | root-router | 1 | Reach console, mailbox, timer, IM endpoints |
| `west/*` | root-router | 1 | Reach west sessions via root |
| `nested/*` | root-router | 2 | Reach nested sessions via root→west |

Note: `nested/*` uses distance 2 because the path is east→root→west→nested.
East-router doesn't know about west→nested directly; it routes through root.

### west-router

| Address Pattern | Neighbor | Distance | Purpose |
|----------------|----------|----------|---------|
| `domain-a/*` | root-router | 1 | Reach console and other domain-a endpoints on root |
| `east/*` | root-router | 1 | Reach east sessions via root |
| `nested/*` | nested-router | 1 | Reach nested sessions directly |

### nested-router

| Address Pattern | Neighbor | Distance | Purpose |
|----------------|----------|----------|---------|
| `domain-a/*` | west-router | 2 | Reach domain-a endpoints via west→root |
| `east/*` | west-router | 2 | Reach east sessions via west→root |
| `west/*` | west-router | 1 | Reach west sessions directly |

## Announce-Learned Routes

These are NOT in the state-file. They are registered at runtime when a peer
connects and announces its session addresses (with `announce_route` permission).

### By Client Instance

| Client | Announced Addresses | Connects To |
|--------|-------------------|------------|
| alpha-client | `east/runtime-alpha/session-alpha-1`, `east/runtime-alpha/session-alpha-2` | east-router |
| delta-client | `east/runtime-delta/session-delta-1` | east-router |
| beta-client | `west/runtime-beta/session-beta-1`, `west/runtime-beta/session-beta-2` | west-router |
| gamma-client | `nested/runtime-gamma/session-gamma-1`, `nested/runtime-gamma/session-gamma-2` | nested-router |
| omega-client | `nested/runtime-omega/session-omega-1` | nested-router |

### By Endpoint

| Endpoint | Announced Address | Connects To |
|----------|------------------|------------|
| console-endpoint | `domain-a/console-runtime/console` | root-router |
| session-control-endpoint | `surface/session-control-endpoint/*` | east-router |
| timer-endpoint | `domain-a/timer-endpoint/timer` | east-router |
| requestion-endpoint | `west/requestion-endpoint/requestion-endpoint` | west-router |
| mailbox-endpoint | `domain-a/mailbox-endpoint/mailbox` | west-router |
| im-endpoint | `domain-a/im-endpoint/session` | nested-router |

## Why Manual Routes Are Needed

Without manual routes, a router only knows about directly-connected peers.
The manual routes create the inter-router backbone:

1. **root-router** needs `east/*` and `west/*` to forward traffic to subtrees.
2. **east-router** needs `domain-a/*`, `west/*`, `nested/*` to reach peers on other subtrees.
3. **west-router** needs `domain-a/*`, `east/*`, `nested/*` to reach peers on other subtrees.
4. **nested-router** needs `domain-a/*`, `east/*`, `west/*` to reach peers on other subtrees.

The `domain-a/*` pattern appears on all non-root routers because several service
endpoints use the `domain-a` namespace, and those endpoints connect to different
routers (console on root, timer on east, mailbox on west, IM on nested).

## Why `domain-a/*` Needs Manual Routes on All Routers

The `domain-a` prefix is used by multiple endpoints that connect to different
routers. A message from gamma-client (`nested`) to console-endpoint
(`domain-a/console-runtime/console` on root) must traverse:

```
gamma → nested-router → west-router → root-router → console-endpoint
```

Each router along the path needs a manual route for `domain-a/*` pointing to
the next hop toward root.

## Route Table Summary

| Router | Manual Routes | Learned at Runtime |
|--------|--------------|-------------------|
| root-router | 2 (east/*, west/*) | console-endpoint announce |
| east-router | 3 (domain-a/*, west/*, nested/*) | alpha, delta, session-control, timer announces |
| west-router | 3 (domain-a/*, east/*, nested/*) | beta, requestion, mailbox announces |
| nested-router | 3 (domain-a/*, east/*, west/*) | gamma, omega, IM announces |
| **Total** | **11** | **14 addresses from 11 peers** |
