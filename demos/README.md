# GlassVein Demos

> **Naming note**: `surface-viewer` is an endpoint *package* name. The `surface` crate is an
> SDK/library. Neither is a wire/router role or a wire field. GV wire knows only
> endpoint/router/address/linkType/subtype/requestId. There is no `surfaceId` wire field.

Demos validate router, endpoint, and transport semantics. They are **not** tests —
they print human-readable output and require a running router unless noted
otherwise.

## 12-process live demo topology

```
root-router :7200
├─ root-viewer          (surface-viewer, upload fan-out)
├─ east-router :7201
│  ├─ alpha-client        (client endpoint)
│  ├─ east-viewer          (surface-viewer, upload fan-out)
│  └─ control-endpoint     (control + request driver)
└─ west-router :7202
   ├─ beta-client          (client endpoint)
   ├─ requestion-endpoint   (requestion cache + upload listener)
   └─ nested-router :7203
      ├─ gamma-client      (client endpoint)
      └─ nested-viewer     (surface-viewer, upload fan-out)
```

### Quick start

Print topology tree and four-link coverage matrix (no processes launched):

```bash
bash demo-topology-tree.sh TOPOLOGY
```

Launch all 12 processes with bounded timeout and log verification:

```bash
bash demo-topology-tree.sh ALL
```

### Four-link coverage matrix

| linkType | subtype | exercised by |
|----------|---------|--------------|
| **upload** | `session_update` | alpha/beta/gamma → root/east/nested viewers |
| **upload** | `requestion_asked` | beta → requestion-endpoint |
| **upload** | `requestion_updated` | requestion-endpoint cache merge |
| **upload** | `requestion_resolved` | requestion cache removal |
| **upload** | `requestion_cancelled` | requestion cache removal |
| **control** | `add_prompt` | control-endpoint → alpha/gamma |
| **control** | `abort_session` | control-endpoint → target session |
| **control** | `compact_session` | control-endpoint → target session |
| **control** | `create_session` | control-endpoint → target runtime |
| **control** | `rename_session` | control-endpoint → target session |
| **control** | `resume_session` | control-endpoint → target session |
| **control** | `requestion_respond` | control-endpoint → target requestion |
| **request** | `runtime_workspace_view_snapshot` | control-endpoint → target runtime |
| **request** | `runtime_requestion_snapshot` | control-endpoint → west/requestion |
| **request** | `runtime_session_view_snapshot` | control-endpoint → target session |
| **request** | `runtime_session_messages` | control-endpoint → target session |
| **response** | mirrors request/control subtype | returned to source address (target=request.source) |
| **response** | wire: `{linkType:"response", subtype, source, target, status, payload}` | addressed response via source/target routing |

Legend:
- **Real routing** — envelope traverses router address lookup + forwarding.
- **Real fan-out** — router copies upload to viewer-capable endpoints.
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
| T2b | upload | surface-viewer witnesses fan-out |
| T3 | upload | Viewer@east isolation (no west/nested) |
| T4 | upload | Viewer@west sees beta+gamma |
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
| T8 | request+response | gv-network-validation automated harness |

---

## gv-network-validation (automated harness)

Self-contained two-router automated validation; no manual setup needed:

```bash
cargo run -p glassvein-demos --bin gv-network-validation
```

Custom port range:

```bash
cargo run -p glassvein-demos --bin gv-network-validation -- --base-port 7350
```

Pingora-backed listener (feature-gated):

```bash
cargo run -p glassvein-demos --features pingora-listener --bin gv-network-validation -- --listener pingora
```

What it validates:

- Starts `root-router` and `east-router` with real default listeners.
- Performs client `Hello` and `Announce`.
- Routes a `SessionEnvelope` across two routers.
- Verifies `session_update` and `requestion.*` upload fan-out via viewer endpoint.
- Sends a `ReadRequest` (`RuntimeSessionMessages`) across routers and observes the read-forward path.

---

## Demo inventory

| Binary | Package | Needs router? | Transport | What it exercises |
| --- | --- | --- | --- | --- |
| `observer-demo` | `glassvein-demos` | **No** | In-process only | Observer library filter + emit/receive |
| `control-demo` | `glassvein-demos` | **No** | In-process only | Control library build addprompt/abort/compact + parse response |
| `gv-network-validation` | `glassvein-demos` | **Starts its own** | Real WebSocket | Multi-router routing, fan-out, read-forward |
| `ws-client-demo` | `glassvein-demos` | **Yes** | Real WebSocket | Single-client Hello + SessionUpdate upload |
| `alpha-client` | `alpha-client` | **Yes** | Real WebSocket | Hello + SessionUpdate (state=running) |
| `beta-client` | `beta-client` | **Yes** | Real WebSocket | Hello + SessionUpdate (state=idle) |
| `gamma-client` | `gamma-client` | **Yes** | Real WebSocket | Hello + SessionUpdate (state=closed) |

### Standalone client demos

These connect to a pre-started router via WebSocket:

```bash
# Start router
cargo run -p router -- --node-id root-router --bind-addr 127.0.0.1:7200

# In separate terminals:
cargo run -p alpha-client -- --router-url ws://127.0.0.1:7200
cargo run -p beta-client  -- --router-url ws://127.0.0.1:7200
cargo run -p gamma-client -- --router-url ws://127.0.0.1:7200
```
