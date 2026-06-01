# GlassVein Demos

> **Naming note**: current demos should use the Rust endpoint packages
> (`console-endpoint`, `session-control-endpoint`, `mailbox-endpoint`,
> `im-endpoint`, `timer-endpoint`, `requestion-endpoint`) plus demo clients.
> GV wire knows only endpoint/router/address/linkType/subtype/requestId.

Demos validate router, endpoint, and transport semantics. They are **not** tests —
they print human-readable output and require a running router unless noted
otherwise.

## Multi-client target demo topology

This is the refreshed target graph. The launch/verification scripts still need a
follow-up implementation pass before the full topology is runnable end-to-end.
Stage-based demo assets live under [`multiprocess/`](multiprocess/).

```
root-router :7200
├─ console-endpoint      (TUI/control/admin/read observer)
├─ east-router :7201
│  ├─ alpha-client        (bash-clientdummy instance)
│  │  ├─ session-alpha-1
│  │  └─ session-alpha-2
│  ├─ delta-client        (bash-clientdummy instance)
│  │  └─ session-delta-1
│  ├─ session-control-endpoint (runtime/session MCP bridge)
│  └─ timer-endpoint      (scheduled control/add_prompt producer)
└─ west-router :7202
   ├─ beta-client          (bash-clientdummy instance)
   │  ├─ session-beta-1
   │  └─ session-beta-2
   ├─ requestion-endpoint   (requestion cache + upload listener)
   ├─ mailbox-endpoint     (store-forward + reminder add_prompt)
   └─ nested-router :7203
      ├─ gamma-client      (bash-clientdummy instance)
      │  ├─ session-gamma-1
      │  └─ session-gamma-2
      ├─ omega-client      (bash-clientdummy instance)
      │  └─ session-omega-1
      └─ im-endpoint       (IM gateway, control/add_prompt bridge)
```

### Quick start

Print topology tree and four-link coverage matrix (no processes launched):

```bash
bash demo-topology-tree.sh TOPOLOGY
```

Launch implementation is pending refresh; this command is currently a follow-up target:

```bash
bash demo-topology-tree.sh ALL
```

### Four-link coverage matrix

| linkType | subtype | exercised by |
|----------|---------|--------------|
| **upload** | `session_update` | alpha/delta/beta/gamma/omega → console/supervisor view via routing/rules |
| **upload** | `requestion_asked` | beta → requestion-endpoint |
| **upload** | `requestion_updated` | requestion-endpoint cache merge |
| **upload** | `requestion_resolved` | requestion cache removal |
| **upload** | `requestion_cancelled` | requestion cache removal |
| **control** | `add_prompt` | console/mailbox/im/timer → target session |
| **control** | `abort_session` | console/session-control → target session |
| **control** | `compact_session` | console/session-control → target session |
| **control** | `create_session` | console/session-control → target runtime |
| **control** | `rename_session` | console/session-control → target session |
| **control** | `resume_session` | console/session-control → target session |
| **control** | `requestion_respond` | requestion/session-control → target requestion |
| **request** | `runtime_workspace_view_snapshot` | console/session-control → target runtime |
| **request** | `runtime_requestion_snapshot` | console/session-control → requestion |
| **request** | `runtime_session_view_snapshot` | console/session-control → target session |
| **request** | `runtime_session_messages` | console/im/session-control → target session |
| **response** | mirrors request/control subtype | returned to source address (target=request.source) |
| **response** | wire: `{linkType:"response", subtype, source, target, status, payload}` | addressed response via source/target routing |

Legend:
- **Real routing** — envelope traverses router address lookup + forwarding.
- **Real fan-out** — router/flow rules copy upload to observer-capable endpoints.
- **Wire-shape only** — envelope constructed correctly but never touches a router (in-process demos).
- **Smoke** — sent over real transport, receipt logged, no assert on delivery.

### Transport verification script

Step-by-step bounded tests against the topology:

```bash
# Quick smoke (build + routers + one upload)
bash verify-ws-transport.sh T0T1T2

# Full four-link matrix
bash verify-ws-transport.sh MATRIX

# Individual link categories
bash verify-ws-transport.sh UPLOAD
bash verify-ws-transport.sh CONTROL
bash verify-ws-transport.sh REQUEST

# Everything
bash verify-ws-transport.sh ALL
```

Verification steps:

| Step | linkType | Description |
|------|----------|-------------|
| T0 | — | Workspace build |
| T1 | — | Start 4 routers |
| T2 | upload | ws-client-demo sends session_update |
| T2b | upload | console/session-control observes fan-out (pending script refresh) |
| T3 | upload | local observer/control endpoint event evidence (pending script refresh) |
| T4 | upload | nested/IM visibility evidence (pending script refresh) |
| T5 | control | add_prompt same-router |
| T5b | control | add_prompt cross-router east→west |
| T5c | control | add_prompt cross-two-levels east→nested |
| T5d | control | abort_session |
| T5e | control | compact_session |
| T6 | upload | requestion-endpoint caches ask/resolve |
| T7a | request+response | runtime_workspace_view_snapshot |
| T7b | request+response | runtime_requestion_snapshot |
| T7c | request+response | runtime_session_view_snapshot |
| T7d | request+response | runtime_session_messages |
| T8 | — | Snapshot WS connections + process table |
| T9 | — | Print coverage matrix + write summary.md |

## Demo inventory

| Binary | Package | Needs router? | Transport | What it exercises |
| --- | --- | --- | --- | --- |
| `observer-demo` | `glassvein-demos` | **No** | In-process only | Observer library filter + emit/receive |
| `control-demo` | `glassvein-demos` | **No** | In-process only | Control library build addprompt/abort/compact + parse response |
| `ws-client-demo` | `glassvein-demos` | **Yes** | Real WebSocket | Single-client Hello + SessionUpdate upload |
| `bash-clientdummy` | `bash-clientdummy` | **Yes** | Real WebSocket | Multi-session stdin-driven dummy (announce + session_update + live loop) |
| `console-endpoint` | `console-endpoint` | **Yes** | Real WebSocket | TUI/observer + command-mode control/request |
| `session-control-endpoint` | `session-control-endpoint` | **Yes** | Real WebSocket | Runtime/session MCP bridge |
| `requestion-endpoint` | `requestion-endpoint` | **Yes** | Real WebSocket | Requestion cache + upload listener |
| `mailbox-endpoint` | `mailbox-endpoint` | **Yes** | Real WebSocket | Mailbox store-forward + reminder |
| `im-endpoint` | `im-endpoint` | **Yes** | Real WebSocket | IM gateway + control/add_prompt bridge |
| `timer-endpoint` | `timer-endpoint` | **Yes** | Real WebSocket | Scheduled control/add_prompt producer |

### Standalone client demos

These connect to a pre-started router via WebSocket:

```bash
# Start router
cargo run -p router -- --node-id root-router --bind-addr 127.0.0.1:7200

# bash-clientdummy (multi-session, stdin-driven)
cargo run -p bash-clientdummy -- \
  --router-url ws://127.0.0.1:7200 \
  --node-id alpha-client \
  --domain east \
  --runtime runtime-alpha \
  --session session-alpha-1 \
  --session session-alpha-2 \
  --stay-alive
```

### Multiprocess demo

Stage-based demo with 4 routers + 5 dummy instances + 6 endpoints (15 processes):

```bash
# Print topology (no processes launched)
bash demo-topology-tree.sh TOPOLOGY

# Run individual stages
bash demos/multiprocess/stages/00-build/run.sh
bash demos/multiprocess/stages/01-router-boot/run.sh
bash demos/multiprocess/stages/02-clientdummy-announce/run.sh
bash demos/multiprocess/stages/03-endpoint-boot/run.sh
```

See `demos/multiprocess/README.md` for full stage list and status.
