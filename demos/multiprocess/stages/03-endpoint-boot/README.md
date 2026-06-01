# Stage 03: Endpoint Boot

Starts all 6 Rust endpoints and verifies they connect to their target routers.

## Prerequisites

- Stage 00 (build) — binaries in `target/debug/`
- Stage 01 (router-boot) — all 4 routers listening:
  - `root-router` on `:7200`
  - `east-router` on `:7201`
  - `west-router` on `:7202`
  - `nested-router` on `:7203`

## Running

```bash
# From GlassVein/ root
bash demos/multiprocess/stages/03-endpoint-boot/run.sh
```

Uses `common.sh` helpers. Missing binaries → PENDING (not FAIL).

## Endpoint → Router Mapping

| # | Endpoint | Router | Announces | Address |
|---|---|---|---|---|
| 1 | console-endpoint | root-router :7200 | No | `east/console-runtime/console` |
| 2 | session-control-endpoint | east-router :7201 | No | `east/session-control-endpoint/sc-demo-session` |
| 3 | timer-endpoint | east-router :7201 | Yes | `east/timer-endpoint/timer` |
| 4 | requestion-endpoint | west-router :7202 | Yes | `west/requestion-endpoint/requestion-endpoint` |
| 5 | mailbox-endpoint | west-router :7202 | Yes | `west/mailbox-endpoint/mailbox` |
| 6 | im-endpoint | nested-router :7203 | Yes | `nested/im-endpoint/im` + `nested/im-backend/im-session` |

## Grant Basis

State files: `demo-state-{root,east,west,nested}.json` in `../state/`.
Grants declaration: `../configs/endpoint-grants-declaration.json` (serde snake_case).

Console admin write is **not** exercised in demo; `root-router.json` admin write grants removed.

## Config Templates

All in `../configs/`:

- `console-endpoint.json` — mode=once (bounded smoke)
- `session-control-endpoint.json` — listen + router_url + source/target
- `timer-endpoint.json` — gv section (domain=east)
- `requestion-endpoint.json` — nodeId + routerUrl + address
- `mailbox-endpoint.json` — reference (launch uses CLI args)
- `im-endpoint.json` — provider accounts (router/address via CLI)

## Logs

Output: `.tmp/gv-stage-03-endpoint-boot-<timestamp>/`
