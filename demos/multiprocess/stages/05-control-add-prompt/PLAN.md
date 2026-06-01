# Stage 05 — control/add_prompt

## Purpose

Verify that `control/add_prompt` envelopes from control endpoints reach target
`bash-clientdummy` instances through real router forwarding, covering same-router,
cross-router, and cross-two-level routing paths.

## Canonical type+subtype

| linkType | subtype | direction |
|----------|---------|-----------|
| control | `add_prompt` | control-endpoint → router → target client |
| response | `add_prompt` | target client → router → source endpoint |

## Prerequisites

- Stage 01–03 complete (routers + clients + endpoints running).
- `session-control-endpoint` connected to `east-router :7201`.

## Inputs

| # | input | value | source |
|---|-------|-------|--------|
| I1 | source endpoint | `session-control-endpoint` | connects to east-router |
| I2 | target session address | `domain/runtime/session` | per coverage matrix |
| I3 | prompt text | `"stage05 smoke prompt for <session>"` | script constant |
| I4 | control payload | `Payload::SessionCommand(AddPrompt { session_id, text })` | constructed by endpoint |

## Coverage Matrix (5 instances × 8 sessions × 3 routing hops)

| # | source | target instance | target session | domain | routing path | hop count |
|---|--------|-----------------|----------------|--------|--------------|-----------|
| 1 | session-control-endpoint | alpha-client | session-alpha-1 | east | east-router (same) | 1 |
| 2 | session-control-endpoint | alpha-client | session-alpha-2 | east | east-router (same) | 1 |
| 3 | session-control-endpoint | delta-client | session-delta-1 | east | east-router (same) | 1 |
| 4 | session-control-endpoint | beta-client | session-beta-1 | west | east→root→west | 3 |
| 5 | session-control-endpoint | beta-client | session-beta-2 | west | east→root→west | 3 |
| 6 | session-control-endpoint | gamma-client | session-gamma-1 | nested | east→root→west→nested | 4 |
| 7 | session-control-endpoint | gamma-client | session-gamma-2 | nested | east→root→west→nested | 4 |
| 8 | session-control-endpoint | omega-client | session-omega-1 | nested | east→root→west→nested | 4 |

## Commands

For each target session, the verification script sends a `control/add_prompt`
envelope. The command is constructed as:

```
type=control, subtype=add_prompt
source=session-control-endpoint address (east/runtime-session-control/session-control-1)
target=<session-address from matrix>
payload=Payload::SessionCommand(AddPrompt { session_id, text })
```

Implementation options (pick one at runtime):
1. **session-control-endpoint CLI**: if it supports `add-prompt <session> <text>`.
2. **Direct WS send**: use a small script or `bash-clientdummy` in interactive
   mode to send the envelope.
3. **Smoke probe**: send via `im_gateway_chat_SendRouteTextMessage` to a bound
   session (requires Stage 03 IM binding).

## Expected Logs / Evidence

### Sender side (session-control-endpoint)

```
TX control/add_prompt target=east/runtime-alpha/session-alpha-1 msg_id=<uuid>
```

### Router side

```
forwarding control/add_prompt from session-control-endpoint to alpha-client
```

### Receiver side (bash-clientdummy)

```
RX typed envelope type/sub=control/add_prompt id=<uuid>
CONTROL subtype=add_prompt command=add_prompt
TX smoke response for control subtype=add_prompt
```

### Observer verification

The smoke response (`response/add_prompt`) should arrive back at the source
endpoint with `{"ok": true, "handledBy": "alpha-client", "smoke": true}`.

### Evidence file (`.tmp/stage05-evidence.json`)

```json
{
  "stage": "05-control-add-prompt",
  "linkType": "control",
  "subtype": "add_prompt",
  "total_targets": 8,
  "targets_confirmed": 8,
  "routing_hops": {
    "same_router": 3,
    "cross_router": 2,
    "cross_two_levels": 3
  },
  "pass": true,
  "details": [
    {
      "session": "session-alpha-1",
      "routing": "same",
      "response_received": true
    },
    ...
  ]
}
```

## Failure Criteria

| # | condition | severity |
|---|-----------|----------|
| F1 | `session-control-endpoint` cannot construct canonical `control/add_prompt` | BLOCK |
| F2 | Envelope not delivered to target client (timeout) | FAIL |
| F3 | Target client receives envelope but subtype ≠ `add_prompt` | FAIL — protocol violation |
| F4 | Smoke response (`response/add_prompt`) not returned to source | FAIL |
| F5 | Cross-router hop (east→west) fails while same-router works | FAIL — routing issue |
| F6 | Cross-two-levels hop (east→nested) fails | FAIL — multi-hop routing issue |
| F7 | Response payload missing `handledBy` field | WARN (smoke format) |

## Timeout & Cleanup

- Each add_prompt probe: timeout 5s per session.
- Total stage timeout: 60s.
- No long-running processes launched.
- If using a direct WS script, wrap in `timeout` and trap for cleanup.
