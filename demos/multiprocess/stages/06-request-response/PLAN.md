# Stage 06 — request/response

## Purpose

Verify that `request/*` envelopes from endpoints reach target `bash-clientdummy`
instances, and that `response/*` envelopes return to the source endpoint through
real router forwarding. Covers all 4 canonical request subtypes.

## Canonical type+subtype

| linkType | subtype | direction |
|----------|---------|-----------|
| request | `runtime_workspace_view_snapshot` | endpoint → client |
| request | `runtime_session_view_snapshot` | endpoint → client |
| request | `runtime_session_messages` | endpoint → client |
| request | `runtime_requestion_snapshot` | endpoint → client |
| response | (mirrors request subtype) | client → endpoint |

## Prerequisites

- Stage 01–03 complete (routers + clients + endpoints running).
- Console-endpoint or session-control-endpoint connected.

## Inputs

| # | input | value |
|---|-------|-------|
| I1 | source endpoint | `console-endpoint` (root-router :7200) or `session-control-endpoint` (east-router :7201) |
| I2 | request subtype | one of the 4 canonical request subtypes |
| I3 | target address | `domain/runtime/session` per coverage matrix |
| I4 | request payload | constructed by endpoint SDK (`ReadRequest::new(...)`) |

## Coverage Matrix

### 6a. runtime_workspace_view_snapshot (runtime-level, no session)

Targets the runtime address `domain/runtime/*` to get the workspace tree.

| # | source | target instance | target domain | routing path | hops |
|---|--------|-----------------|---------------|--------------|------|
| 1 | console-endpoint | alpha-client | east | root→east | 2 |
| 2 | console-endpoint | beta-client | west | root→west | 2 |
| 3 | console-endpoint | gamma-client | nested | root→west→nested | 3 |
| 4 | session-control-endpoint | alpha-client | east | same (east) | 1 |
| 5 | session-control-endpoint | delta-client | east | same (east) | 1 |

### 6b. runtime_session_view_snapshot (session-level)

Targets a specific session to get its state/title.

| # | source | target instance | target session | routing path | hops |
|---|--------|-----------------|----------------|--------------|------|
| 1 | console-endpoint | alpha-client | session-alpha-1 | root→east | 2 |
| 2 | console-endpoint | alpha-client | session-alpha-2 | root→east | 2 |
| 3 | console-endpoint | delta-client | session-delta-1 | root→east | 2 |
| 4 | console-endpoint | beta-client | session-beta-1 | root→west | 2 |
| 5 | console-endpoint | beta-client | session-beta-2 | root→west | 2 |
| 6 | console-endpoint | gamma-client | session-gamma-1 | root→west→nested | 3 |
| 7 | console-endpoint | gamma-client | session-gamma-2 | root→west→nested | 3 |
| 8 | console-endpoint | omega-client | session-omega-1 | root→west→nested | 3 |

### 6c. runtime_session_messages (session-level)

Targets a specific session to get its message log.

| # | source | target instance | target session | routing path | hops |
|---|--------|-----------------|----------------|--------------|------|
| 1 | session-control-endpoint | alpha-client | session-alpha-1 | same (east) | 1 |
| 2 | session-control-endpoint | alpha-client | session-alpha-2 | same (east) | 1 |
| 3 | session-control-endpoint | delta-client | session-delta-1 | same (east) | 1 |
| 4 | session-control-endpoint | beta-client | session-beta-1 | east→root→west | 3 |
| 5 | session-control-endpoint | beta-client | session-beta-2 | east→root→west | 3 |
| 6 | session-control-endpoint | gamma-client | session-gamma-1 | east→root→west→nested | 4 |
| 7 | session-control-endpoint | gamma-client | session-gamma-2 | east→root→west→nested | 4 |
| 8 | session-control-endpoint | omega-client | session-omega-1 | east→root→west→nested | 4 |

### 6d. runtime_requestion_snapshot (runtime-level)

Targets the runtime address to get requestion cache state.

| # | source | target instance | target domain | routing path | hops |
|---|--------|-----------------|---------------|--------------|------|
| 1 | console-endpoint | alpha-client | east | root→east | 2 |
| 2 | console-endpoint | beta-client | west | root→west | 2 |
| 3 | session-control-endpoint | gamma-client | nested | east→root→west→nested | 4 |

## Commands

For each target, construct and send a `ReadRequest`:

```
type=request, subtype=<one of 4 subtypes>
source=<source-endpoint-address>
target=<target-session-or-runtime-address>
```

The `bash-clientdummy` handler responds with:
- `runtime_workspace_view_snapshot` → `{"runtimeId", "workspace", "tree": [...]}`
- `runtime_session_view_snapshot` → `{"runtimeId", "sessionId", "state", "title"}`
- `runtime_session_messages` → `{"runtimeId", "sessionId", "messages": [...]}`
- `runtime_requestion_snapshot` → `{"runtimeId", "requestions": []}`

## Expected Logs / Evidence

### Sender side (endpoint)

```
TX request/runtime_session_view_snapshot target=east/runtime-alpha/session-alpha-1 msg_id=<uuid>
RX ReadResponse subtype=runtime_session_view_snapshot status=Ok request_id=<uuid>
```

### Receiver side (bash-clientdummy)

```
RX ReadRequest subtype=runtime_session_view_snapshot request_id=<uuid> source=... target=...
TX ReadResponse subtype=runtime_session_view_snapshot
```

### Response payload validation

Each response must contain:
- `runtimeId` field matching the target runtime
- For session-level: `sessionId` field matching the target session
- No error field (unless session not found, which is a test setup issue)

### Evidence file (`.tmp/stage06-evidence.json`)

```json
{
  "stage": "06-request-response",
  "linkType": "request",
  "subtypes_tested": [
    "runtime_workspace_view_snapshot",
    "runtime_session_view_snapshot",
    "runtime_session_messages",
    "runtime_requestion_snapshot"
  ],
  "total_probes": 24,
  "probes_confirmed": 24,
  "per_subtype": {
    "runtime_workspace_view_snapshot": {"sent": 5, "responded": 5},
    "runtime_session_view_snapshot": {"sent": 8, "responded": 8},
    "runtime_session_messages": {"sent": 8, "responded": 8},
    "runtime_requestion_snapshot": {"sent": 3, "responded": 3}
  },
  "pass": true
}
```

## Failure Criteria

| # | condition | severity |
|---|-----------|----------|
| F1 | Endpoint cannot construct canonical `request/*` envelope | BLOCK |
| F2 | Request not delivered to target client (timeout) | FAIL |
| F3 | Client receives request but subtype is corrupted | FAIL — protocol violation |
| F4 | Response not returned to source endpoint | FAIL |
| F5 | Response payload missing required fields (`runtimeId`, `sessionId`) | FAIL |
| F6 | Cross-router request fails while same-router works | FAIL — routing issue |
| F7 | Multi-hop request (east→nested) fails | FAIL — multi-hop issue |
| F8 | Requestion snapshot returns unexpected non-empty list | WARN (initial state) |

## Timeout & Cleanup

- Per-request probe timeout: 5s.
- Total stage timeout: 120s (covers all 24 probes).
- No long-running processes launched by this stage.
