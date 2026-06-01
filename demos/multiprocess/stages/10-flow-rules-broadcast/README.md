# Stage 10: Flow-Rules Broadcast

## Purpose

Verify that rule-driven mirror, fanout, and broadcast mechanisms work for
session_update and other upload subtypes once the ForwardEngine converges
these capabilities.

## Status: PENDING — Phase B Not Complete

**This stage cannot produce real PASS results until ForwardEngine convergence
(Phase D) is implemented.** The current router handles fanout to surface viewers
via legacy code paths (`router/src/envelope_forward/legacy.rs::fanout_upload_to_surface_viewers`),
not through the `core::rule::RuleTable`.

### Current RuleTable capabilities (core/src/rule/)

| Action | Description |
|--------|-------------|
| `Drop { reason }` | Drop envelope with reason |
| `ForceNeighbor { neighbor_id }` | Override route table, forward to specific neighbor |
| `DenyNeighbor { neighbor_id }` | Remove neighbor from route candidates |
| `Continue` | No-op, fall through to route resolution |

### What is NOT yet available

- **Mirror action**: Copy an envelope to an additional destination (e.g., observer endpoint)
- **Fanout action**: Broadcast to all subscribers of a given subtype
- **Broadcast action**: Send to all connected surface viewers

These require either:
1. A new `RuleAction::Mirror { target_address }` or `RuleAction::Fanout` variant
2. Or convergence of the router's legacy fanout logic into ForwardEngine

### What currently works (legacy path)

The router already fans out `session_update` uploads to surface-viewer endpoints
via `fanout_upload_to_surface_viewers()` in `router/src/envelope_forward/legacy.rs`.
This is NOT rule-driven — it is hardcoded in the router's dispatch path.

## Design for future verification

When Phase B/D converges fanout into ForwardEngine rules, this stage should:

### Test 1: Rule-driven mirror

```json
{
  "id": "mirror-session-update-to-console",
  "priority": 100,
  "enabled": true,
  "matcher": {
    "link_type": "upload",
    "subtype": "session_update"
  },
  "action": {
    "Mirror": {
      "target_address": { "domain": "domain-a", "runtime": "console-runtime", "session": "console" }
    }
  }
}
```

**Verify**: console-endpoint receives a copy of every session_update upload.

### Test 2: Rule-driven fanout

```json
{
  "id": "fanout-session-update-to-observers",
  "priority": 200,
  "enabled": true,
  "matcher": {
    "link_type": "upload",
    "subtype": "session_update"
  },
  "action": {
    "Fanout": {
      "subscriber_tag": "surface_viewer"
    }
  }
}
```

**Verify**: All surface-viewer endpoints receive the upload.

### Test 3: Rule-driven broadcast suppression

```json
{
  "id": "suppress-internal-uploads",
  "priority": 50,
  "enabled": true,
  "matcher": {
    "from_neighbor": "internal-client",
    "link_type": "upload"
  },
  "action": { "Drop": { "reason": "internal-only" } }
}
```

**Verify**: Uploads from internal-client are not forwarded anywhere.

## Current verification approach

Since Phase B is not complete, this stage:
1. **Documents** the expected behavior
2. **Checks** that the legacy fanout path works (session_update reaches surface-viewer)
3. **Marks** rule-driven tests as PENDING, not PASS

## Script

Run: `bash demos/multiprocess/stages/10-flow-rules-broadcast/verify.sh [LOG_DIR]`
