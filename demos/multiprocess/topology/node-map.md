# Demo Node Map

## Topology Tree

```text
root-router :7200
├── console-endpoint          (TUI/control/admin/read observer)
├── east-router :7201
│   ├── alpha-client          (bash-clientdummy)
│   │   ├── session-alpha-1
│   │   └── session-alpha-2
│   ├── delta-client          (bash-clientdummy)
│   │   └── session-delta-1
│   ├── session-control-endpoint  (runtime/session MCP bridge)
│   └── timer-endpoint        (scheduled control/add_prompt producer)
└── west-router :7202
    ├── beta-client           (bash-clientdummy)
    │   ├── session-beta-1
    │   └── session-beta-2
    ├── requestion-endpoint   (requestion cache + upload listener)
    ├── mailbox-endpoint      (store-forward + reminder add_prompt)
    └── nested-router :7203
        ├── gamma-client      (bash-clientdummy)
        │   ├── session-gamma-1
        │   └── session-gamma-2
        ├── omega-client      (bash-clientdummy)
        │   └── session-omega-1
        └── im-endpoint       (IM gateway, control/add_prompt bridge)
```

## Process Inventory

### Routers (4)

| # | Node ID | Bind Address | Upstream |
|---|---------|-------------|----------|
| 1 | root-router | 127.0.0.1:7200 | — |
| 2 | east-router | 127.0.0.1:7201 | root-router (ws://127.0.0.1:7200) |
| 3 | west-router | 127.0.0.1:7202 | root-router (ws://127.0.0.1:7200) |
| 4 | nested-router | 127.0.0.1:7203 | west-router (ws://127.0.0.1:7202) |

### bash-clientdummy Instances (5)

| # | Instance ID | Connects To | Sessions |
|---|------------|------------|----------|
| 5 | alpha-client | east-router :7201 | session-alpha-1, session-alpha-2 |
| 6 | delta-client | east-router :7201 | session-delta-1 |
| 7 | beta-client | west-router :7202 | session-beta-1, session-beta-2 |
| 8 | gamma-client | nested-router :7203 | session-gamma-1, session-gamma-2 |
| 9 | omega-client | nested-router :7203 | session-omega-1 |

### Service Endpoints (6)

| # | Endpoint ID | Connects To | Role |
|---|------------|------------|------|
| 10 | console-endpoint | root-router :7200 | TUI, control, admin, read observer |
| 11 | session-control-endpoint | east-router :7201 | runtime/session MCP bridge |
| 12 | timer-endpoint | east-router :7201 | scheduled control/add_prompt producer |
| 13 | requestion-endpoint | west-router :7202 | requestion cache + upload listener |
| 14 | mailbox-endpoint | west-router :7202 | mailbox store-forward + reminder |
| 15 | im-endpoint | nested-router :7203 | IM gateway, control/add_prompt bridge |

## Total Process Count: 15

- 4 routers
- 5 bash-clientdummy instances
- 6 service endpoints

## Inter-Router Links

```text
root-router ──ws── east-router
root-router ──ws── west-router
west-router ──ws── nested-router
```

Root is the topology root. East and West connect directly to root.
Nested connects through west (depth 2 from root).

## Session Addresses (business)

| Client | Router | Address pattern |
|---|---|---|
| alpha-client | east :7201 | `east/runtime-alpha/session-alpha-1`, `east/runtime-alpha/session-alpha-2` |
| delta-client | east :7201 | `east/runtime-delta/session-delta-1` |
| beta-client | west :7202 | `west/runtime-beta/session-beta-1`, `west/runtime-beta/session-beta-2` |
| gamma-client | nested :7203 | `nested/runtime-gamma/session-gamma-1`, `nested/runtime-gamma/session-gamma-2` |
| omega-client | nested :7203 | `nested/runtime-omega/session-omega-1` |

## Endpoint Addresses

| Endpoint | Connects to | Address |
|---|---|---|
| console-endpoint | root-router :7200 | `domain-a/console-runtime/console` |
| session-control-endpoint | east-router :7201 | `surface/session-control-endpoint/*` |
| timer-endpoint | east-router :7201 | `domain-a/timer-endpoint/timer` |
| requestion-endpoint | west-router :7202 | `west/requestion-endpoint/requestion-endpoint` |
| mailbox-endpoint | west-router :7202 | `domain-a/mailbox-endpoint/mailbox` |
| im-endpoint | nested-router :7203 | `domain-a/im-endpoint/session` |

## State-File → Router Mapping

| Router | State file |
|---|---|
| root-router | `state/demo-state-root.json` |
| east-router | `state/demo-state-east.json` |
| west-router | `state/demo-state-west.json` |
| nested-router | `state/demo-state-nested.json` |

## bash-clientdummy CLI Reference

```bash
bash-clientdummy \
  --router-url ws://127.0.0.1:7201 \
  --node-id alpha-client \
  --domain east \
  --runtime runtime-alpha \
  --session session-alpha-1 \
  --session session-alpha-2 \
  --stay-alive
```

Multi-session: use `--session` flag repeatedly. Each session gets its own
announce + session_update on startup.
