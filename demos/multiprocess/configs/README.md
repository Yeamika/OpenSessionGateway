# Demo Configs

Demo-only config templates for routers, endpoints, and `bash-clientdummy`
instances should live here.

Do not store real credentials or production config in this folder.

## Endpoint Config Templates (Stage 03)

| File | Endpoint | Router | Announces | Notes |
|---|---|---|---|---|
| `console-endpoint.json` | console | root-router (:7200) | No | mode=once, LinkHandshake only |
| `session-control-endpoint.json` | session-control | east-router (:7201) | No | listen + router_url, LinkHandshake only |
| `timer-endpoint.json` | timer | east-router (:7201) | Yes `east/timer-endpoint/timer` | gv section with source/target |
| `requestion-endpoint.json` | requestion | west-router (:7202) | Yes `west/requestion-endpoint/requestion-endpoint` | Address aligned with topology |
| `mailbox-endpoint.json` | mailbox | west-router (:7202) | Yes `west/mailbox-endpoint/mailbox` | Reference; launch uses CLI args |
| `im-endpoint.json` | IM | nested-router (:7203) | Yes `nested/im-endpoint/im` | Provider accounts; address via CLI |
| `endpoint-grants-declaration.json` | all 6 | — | — | Grants declaration (serde snake_case) |

All endpoint addresses use router domain prefix (east/, west/, nested/) per topology.
Grant names use serde snake_case (`announce_route`, `control_add_prompt`, etc.).

## Port Assignments

| Resource | Port |
|---|---|
| root-router | 7200 |
| east-router | 7201 |
| west-router | 7202 |
| nested-router | 7203 |
| session-control HTTP | 7310 |
| timer HTTP | 8789 |
| requestion HTTP | 7318 |
| mailbox HTTP | 7311 |
| IM HTTP | 4093 |

## Stage-Specific Configs

Stages 07 and 08 have their own config copies under:
- `stages/07-requestion-flow/configs/requestion-west.json`
- `stages/08-mailbox-store-forward/configs/mailbox-west.json`

These are identical to the shared configs above but kept local to each stage
for self-contained execution.
