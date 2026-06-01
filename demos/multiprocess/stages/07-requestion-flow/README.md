# Stage 07 — Requestion Flow

Verify the full requestion lifecycle: ask → update → resolve → cancel, plus
outbound `control/requestion_respond` from the requestion-endpoint.

## Prerequisites

- Stage 01 (router-boot): root/east/west/nested routers running.
- Stage 02 (clientdummy-announce): alpha-client connected to east-router with
  `session-alpha-1`.
- Stage 03 (endpoint-boot): requestion-endpoint connected to west-router.

## Topology

```
east-router :7201
├─ alpha-client (runtime-alpha, session-alpha-1)
│  └─ emits: requestion_asked, requestion_updated,
│            requestion_resolved, requestion_cancelled
└─ ... (other endpoints)

west-router :7202
├─ requestion-endpoint (requestion-rt, requestion)
│  └─ receives uploads, sends requestion_respond
└─ ...
```

Address map:

| Node | Domain | Runtime | Session | Router |
|------|--------|---------|---------|--------|
| alpha-client | east | runtime-alpha | session-alpha-1 | east-router :7201 |
| requestion-endpoint | domain-a | requestion-endpoint | requestion-endpoint | west-router :7202 |

## Scenarios

### S07-1: requestion_asked

| Field | Value |
|-------|-------|
| linkType | `upload` |
| subtype | `requestion_asked` |
| source | east/runtime-alpha/session-alpha-1 |
| target | domain-a/requestion-endpoint/requestion-endpoint |
| payload | `{ "sessionID": "session-alpha-1", "requestID": "req-001", "title": "demo permission" }` |

**Expected evidence**: requestion-endpoint cache contains `req-001` as pending.
Web UI `GET /api/requestions` returns it.

### S07-2: requestion_updated

| Field | Value |
|-------|-------|
| linkType | `upload` |
| subtype | `requestion_updated` |
| source | east/runtime-alpha/session-alpha-1 |
| target | domain-a/requestion-endpoint/requestion-endpoint |
| payload | `{ "sessionID": "session-alpha-1", "requestID": "req-001", "title": "updated title" }` |

**Expected evidence**: cache title for `req-001` changes to "updated title".

### S07-3: requestion_resolved

| Field | Value |
|-------|-------|
| linkType | `upload` |
| subtype | `requestion_resolved` |
| source | east/runtime-alpha/session-alpha-1 |
| target | domain-a/requestion-endpoint/requestion-endpoint |
| payload | `{ "sessionID": "session-alpha-1", "requestID": "req-001" }` |

**Expected evidence**: `req-001` removed from pending cache.

### S07-4: requestion_cancelled (new ask then cancel)

| Step | Field | Value |
|------|-------|-------|
| 1 | linkType | `upload` |
| | subtype | `requestion_asked` |
| | payload | `{ "sessionID": "session-alpha-1", "requestID": "req-002", "title": "will cancel" }` |
| 2 | linkType | `upload` |
| | subtype | `requestion_cancelled` |
| | payload | `{ "sessionID": "session-alpha-1", "requestID": "req-002" }` |

**Expected evidence**: `req-002` removed from pending cache.

### S07-5: control/requestion_respond

After S07-1 (req-001 pending), use requestion-endpoint web API to approve:

| Field | Value |
|-------|-------|
| linkType | `control` |
| subtype | `requestion_respond` |
| source | domain-a/requestion-endpoint/requestion-endpoint |
| target | east/runtime-alpha/session-alpha-1 |
| payload | `{ "sessionID": "session-alpha-1", "requestID": "req-001", "decision": "approve" }` |

**Expected evidence**: alpha-client receives the control envelope (logged by
bash-clientdummy handler). The requestion-endpoint also emits
`requestion_resolved` upload after successful respond.

## Script

`run.sh` is a bounded smoke script:

1. Assumes routers + alpha-client are already running (from stages 01–03).
2. Starts requestion-endpoint with `configs/requestion-west.json`.
3. Waits for connection.
4. Sends requestion lifecycle envelopes via `fake-client.mjs` or direct WS.
5. Queries requestion-endpoint API to verify cache state.
6. Sends `requestion_respond` via API.
7. Prints summary.
8. Cleans up requestion-endpoint process.

All processes are killed on exit via trap. Timeout: 60 seconds.

## Evidence file

Output goes to `.tmp/stage-07-evidence.json` with:

```json
{
  "stage": "07-requestion-flow",
  "timestamp": "ISO-8601",
  "scenarios": [
    { "id": "S07-1", "name": "requestion_asked", "status": "pass|fail", "detail": "..." },
    { "id": "S07-2", "name": "requestion_updated", "status": "pass|fail", "detail": "..." },
    { "id": "S07-3", "name": "requestion_resolved", "status": "pass|fail", "detail": "..." },
    { "id": "S07-4", "name": "requestion_cancelled", "status": "pass|fail", "detail": "..." },
    { "id": "S07-5", "name": "requestion_respond", "status": "pass|fail", "detail": "..." }
  ],
  "overall": "pass|fail"
}
```

## Non-goals

- Does NOT modify router rules, manual routes, or state-files.
- Does NOT start routers (assumes Stage 01).
- Does NOT test flow-rule fanout (Stage 10).
