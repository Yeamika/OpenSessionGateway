# Stage 04 — session_update Broadcast

## Purpose

Verify that `upload/session_update` envelopes from all 5 `bash-clientdummy`
instances reach observer-capable endpoints through real router forwarding.

## Canonical type+subtype

| linkType | subtype | direction |
|----------|---------|-----------|
| upload | `session_update` | client → router → observer endpoints |

## Prerequisites

- Stage 01 (router-boot): 4 routers running (root/east/west/nested).
- Stage 02 (clientdummy-announce): 5 bash-clientdummy instances connected and
  sessions announced.
- Stage 03 (endpoint-boot): console-endpoint and session-control-endpoint running.

## Inputs

None beyond the running infrastructure from stages 01–03. Each dummy client
sends `session_update` automatically during its initial handshake sequence (see
`bash-clientdummy` `[4/5] Sending initial session_update...`).

## Coverage Matrix (5 instances × 8 sessions)

| # | instance | node_id | domain | router | session | session_update sent | observed by |
|---|----------|---------|--------|--------|---------|---------------------|-------------|
| 1 | alpha-client | alpha-client | east | east-router :7201 | session-alpha-1 | Yes (auto) | console, session-control |
| 2 | alpha-client | alpha-client | east | east-router :7201 | session-alpha-2 | Yes (auto) | console, session-control |
| 3 | delta-client | delta-client | east | east-router :7201 | session-delta-1 | Yes (auto) | console, session-control |
| 4 | beta-client | beta-client | west | west-router :7202 | session-beta-1 | Yes (auto) | console, session-control |
| 5 | beta-client | beta-client | west | west-router :7202 | session-beta-2 | Yes (auto) | console, session-control |
| 6 | gamma-client | gamma-client | nested | nested-router :7203 | session-gamma-1 | Yes (auto) | console (via 3 hops) |
| 7 | gamma-client | gamma-client | nested | nested-router :7203 | session-gamma-2 | Yes (auto) | console (via 3 hops) |
| 8 | omega-client | omega-client | nested | nested-router :7203 | session-omega-1 | Yes (auto) | console (via 3 hops) |

## Commands

No additional commands needed. The `bash-clientdummy` main sequence already
sends `session_update` with `state=Running` and a title for each session at
startup (step [4/5]).

To trigger additional state changes (optional smoke):

```bash
# Via interactive stdin to a running bash-clientdummy:
update session-alpha-1 active
update session-beta-2 idle
close session-gamma-1
```

## Expected Logs / Evidence

### Sender side (each bash-clientdummy)

```
[4/5] Sending initial session_update...
  OK: session_update sent for session-alpha-1 (msg_id=<uuid>)
```

### Router side (debug log, if enabled)

```
forwarding upload/session_update from alpha-client to <observer-peer>
```

### Observer side (console-endpoint / session-control-endpoint)

```
RX typed envelope type/sub=upload/session_update id=<uuid>
```

### Evidence file (`.tmp/stage04-evidence.json`)

```json
{
  "stage": "04-session-update-broadcast",
  "linkType": "upload",
  "subtype": "session_update",
  "total_sessions": 8,
  "sessions_observed": 8,
  "pass": true,
  "details": [
    {"session": "session-alpha-1", "observed_by": ["console", "session-control"]},
    ...
  ]
}
```

## Failure Criteria

| # | condition | severity |
|---|-----------|----------|
| F1 | Any bash-clientdummy fails to connect or announce | BLOCK — cannot proceed |
| F2 | `session_update` not sent for any of the 8 sessions | FAIL |
| F3 | Observer endpoint does not observe `session_update` for ≥1 session | FAIL |
| F4 | Router log shows forward error for `upload/session_update` | FAIL |
| F5 | Envelope uses non-canonical subtype (not `session_update`) | FAIL — protocol violation |

## Timeout & Cleanup

- Verification script must use bounded timeout (default 30s).
- No long-running processes launched by this stage.
- If running a standalone smoke test, use `timeout` wrapper and kill background
  processes in a trap.
