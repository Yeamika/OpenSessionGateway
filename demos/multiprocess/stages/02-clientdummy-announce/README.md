# Stage 02: clientdummy-announce

## Purpose

Launch `bash-clientdummy` instances for all 5 demo clients and verify that
each connects, sends LinkHandshake, announces its sessions, and sends
initial `upload/session_update`.

## Prerequisites

- Stage 01 (router-boot) must have started root/east/west/nested routers.
- Binary `bash-clientdummy` must be built (`cargo build -p bash-clientdummy`).

## Topology

```text
east-router :7201
├── alpha-client   → east/runtime-alpha/{session-alpha-1, session-alpha-2}
└── delta-client   → east/runtime-delta/session-delta-1

west-router :7202
└── beta-client    → west/runtime-beta/{session-beta-1, session-beta-2}

nested-router :7203
├── gamma-client   → nested/runtime-gamma/{session-gamma-1, session-gamma-2}
└── omega-client   → nested/runtime-omega/session-omega-1
```

## How to run

```bash
bash demos/multiprocess/stages/02-clientdummy-announce/launch.sh
```

## Verification

The launch script writes logs to `.tmp/gv-stage02-<timestamp>/` and runs
automated checks:

1. Each instance connects to the correct router.
2. LinkHandshake sent (peer_id matches --node-id).
3. Announce messages sent for each session address.
4. Initial `upload/session_update` sent for each session.
5. Binary stays alive for the configured listen window.

## Stdin commands (when --interactive)

```text
update <session> <state>   — send session_update (running/active/idle/closed)
message <session> <text>   — append local message log entry
close <session>            — send session_update state=closed
help                       — show commands
quit                       — exit
```
