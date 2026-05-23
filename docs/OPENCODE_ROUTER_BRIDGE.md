<!-- historical / pre-cleanup: references session-links (now osgp), control-surface (now control-endpoint), observer-surface (now surface-viewer). See README.md and AGENTS.md for current canonical structure. -->

# OpenCode Router Bridge — 首次验收设计

## 1. 概述

本文档描述 opencode (TypeScript WS client) 与 GlassVein Rust router 之间的协议映射和首次验收方案。

### 核心架构决策

**opencode-router 直接复用 `router/`**，不复制路由逻辑。

- 端侧 opencode-router 优先复用现有 `router/`（RouterNode、surface role、tap、upstream）
- opencode 只新增 TS workspace adapter / bridge 层
- 若保留 `opencode-router` crate，应是**薄 wrapper/launcher + TS adapter**，不重复路由逻辑

**Pingora 迁移**: 详见 `docs/PINGORA_ROUTER_MIGRATION.md`
- Wire transport 仍是 WebSocket
- Pingora 负责 server/listener runtime
- Router 仍只转发，不保存业务状态
- 上游连接暂保留 tokio-tungstenite

### 首次验收范围

- **Rust router**: 单例运行（复用 `router/`），接受多个 TS WS client 连接
- **TS WS client**: 每工作区一个，模拟 opencode 前端行为
- **协议映射**: opencode event/control ↔ GlassVein LinkMessage

## 2. 架构

```
┌─────────────────────────────────────────────────────────────────────┐
│  opencode-router (端侧)                                             │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  crates/router (RouterNode) — 复用，不复制                   │   │
│  │  - 表面角色 (Client/Router/ControlSurface/ObserverSurface)   │   │
│  │  - 本地 tap 事件                                             │   │
│  │  - 上游连接 (可连主 GV 网络)                                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  TS Adapter / Bridge 层 (新增)                               │   │
│  │  - opencode event → LinkMessage 转换                        │   │
│  │  - LinkMessage → opencode event 转换                        │   │
│  │  - 每工作区一个 WS 连接                                      │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  TS WS Client   │  │  TS WS Client   │  │  主 GV 网络     │
│  (workspace-a)  │  │  (workspace-b)  │  │  (可选上游)      │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

## 3. 拓扑

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│  TS WS Client   │      │  Rust Router    │      │  TS WS Client   │
│  (workspace-a)  │◄────►│  (singleton)    │◄────►│  (workspace-b)  │
│  127.0.0.1:7240 │      │  127.0.0.1:7240 │      │  127.0.0.1:7240 │
└─────────────────┘      └─────────────────┘      └─────────────────┘
                              │
                              ▼ (可选)
                         ┌─────────────────┐
                         │  主 GV 网络     │
                         │  (upstream)     │
                         └─────────────────┘
```

## 4. 协议映射

### 4.1 Hello Handshake

**Wire 格式规范**:
- 格式: `{nodeId, role, addresses}`
- 大小写: **camelCase** (JS/Rust 统一)
- 无 `type` tag: Hello 是裸 JSON，不是 `LinkMessage` 包装

**TS Client → Router:**
```json
{
  "nodeId": "workspace-a-client",
  "role": "client",
  "addresses": [
    { "domain": "workspace-a", "runtime": "runtime-1", "session": "session-1" }
  ]
}
```

**Router → TS Client (reply):**
```json
{
  "nodeId": "root-router",
  "role": "router",
  "addresses": []
}
```

**关键约束**:
- Hello 消息**没有** `type` 字段，直接是 `{nodeId, role, addresses}`
- `role` 值: `"client"`, `"router"`, `{"control_surface": {"surface_id": "..."}}`, `"observer_surface"`
- `addresses` 是 `SessionAddress[]`，每个元素 `{domain, runtime?, session?}`
- Bridge 连接后**必须**调用 `sendWorkspaceRegister()` 注册工作区地址

### 4.2 opencode Event → GlassVein LinkMessage

| opencode Event | GlassVein LinkMessage | Payload |
|---|---|---|
| `session.status` | `Envelope` (kind=`session_update`) | `{ sessionID, state: "busy"\|"idle"\|"stopped"\|"waiting", metadata: { reason, extraInfo } }` |
| ~~`message.updated`~~ | ~~`Envelope` (kind=`opencode_event`)~~ | **删除标记**：不纳入 GV 主链路；普通 opencode message 事件不作为当前验收目标 |
| ~~`message.part.updated`~~ | ~~`Envelope` (kind=`opencode_event`)~~ | **删除标记**：不纳入 GV 主链路；如需详情走读取/query，不走 `opencode_event` |
| `permission.asked` | `Envelope` (kind=`permission`) | `{ sessionID, requestID, kind, title, description }`; 不使用 `permissionID` 字段名 |
| `question.asked` | `Envelope` (kind=`question`) | `{ sessionID, requestID, title, questions }`; 不使用 `questionID` 字段名 |
| ~~`tui.session.select`~~ | ~~`Envelope` (kind=`opencode_event`)~~ | **删除标记**：不纳入 GV 主链路 |

### 4.3 opencode Control → GlassVein LinkMessage

新主链路统一使用一个控制信封：

```json
{
  "type": "envelope",
  "data": {
    "kind": "session_command",
    "payload": { "command": "add_prompt", "sessionID": "ses_xxx", "text": "Hello" }
  }
}
```

`session_update` 只用于命令执行后的状态上报，不再承载控制命令。

| opencode Control | GlassVein LinkMessage | Payload |
|---|---|---|
| `add_prompt` | `Envelope` (kind=`session_command`) | `{ command: "add_prompt", sessionID, text, role, correlationID }` |
| `abort_session` | `Envelope` (kind=`session_command`) | `{ command: "abort_session", sessionID, reason? }` |
| `compact_session` | `Envelope` (kind=`session_command`) | `{ command: "compact_session", sessionID, wait? }` |
| `create_session` | `Envelope` (kind=`session_command`) | `{ command: "create_session", instanceWorkspaceDirectory, text, title?, model?, agent? }` |
| `ListSession` | `ReadRequest` (op=`list_workspaces`) | `ListWorkspaceInfo { include_sessions: true }` |
| `rename_session` | `Envelope` (kind=`session_command`) | `{ command: "rename_session", sessionID, title }` |
| `resume_session` | `Envelope` (kind=`session_command`) | `{ command: "resume_session", sessionID }`；无底层 API 时必须明确返回 unsupported/not implemented |
| ~~`SetDisplaySession`~~ | ~~`Envelope`~~ | **删除/不迁移**：不纳入 GV 新主链路 |

### 4.4 Response Mapping

| GlassVein Response | opencode Event |
|---|---|
| `ReadResponse` (ok) | `query.response` |
| `ReadResponse` (error) | `query.error` |
| `Envelope` (kind=`session_update`) | `session.status` |
| `Envelope` (kind=`permission`) | `permission.response` |
| `Envelope` (kind=`question`) | `question.response` |

## 5. session_update 广播机制

### 5.1 语义说明

**方案 A: Router 自动广播 session_update 给 ObserverSurface**

当 plugin 发送 `session_update` 信封时，router 会自动 fan-out 给所有 ObserverSurface peer。

**关键约束**:
- Plugin 发送 `target=this.address`（source=target=self），这是**路由目标**，不是观察语义
- Router 检测 `kind == "session_update"` 后，额外 fan-out 给 ObserverSurface
- Observer 通过本地 tap 接收，不需要 plugin 设置 Broadcast target

### 5.2 数据流

```
┌─────────────────────────────────────────────────────────────────┐
│  1. Plugin 发送 session_update                                  │
│     Envelope {                                                  │
│       source: workspace-a/runtime-1/session-1,                  │
│       target: workspace-a/runtime-1/session-1,  ← 路由目标      │
│       kind: "session_update",                                   │
│       payload: { sessionID, state, metadata: { reason, extraInfo } } │
│     }                                                           │
├─────────────────────────────────────────────────────────────────┤
│  2. Router 处理                                                  │
│     - forward_envelope() 被调用                                  │
│     - 路由决策: NextHop::Local (target 是本地 session)           │
│     - 检测 kind == "session_update"                             │
│     - emit_tap(ForwardPeer { kind: "session_update", ... })     │
│     - 额外 fan-out 给所有 ObserverSurface peer                   │
├─────────────────────────────────────────────────────────────────┤
│  3. Observer 收到                                                │
│     tap_event = {                                               │
│       type: "forward_peer",                                     │
│       summary: {                                                │
│         id: "uuid",                                             │
│         source: "workspace-a/runtime-1/session-1",              │
│         target: "workspace-a/runtime-1/session-1",              │
│         kind: "session_update",                                 │
│         ttl: 32                                                 │
│       },                                                        │
│       peer_id: "workspace-a-client",                            │
│       distance: 0                                               │
│     }                                                           │
└─────────────────────────────────────────────────────────────────┘
```

### 5.3 不采用的方案

**不采用 source=target=self 作为观察语义**:
- Plugin 仍发 `target=this.address`（路由目标）
- Router 补充 observer 广播，不需要 plugin 改代码
- Observer 不需要订阅 Broadcast target

### 5.4 改动范围

| 组件 | 改动 | 说明 |
|---|---|---|
| `crates/router/src/lib.rs` | `forward_envelope()` | 检测 `kind == "session_update"` 时额外 fan-out |
| `crates/router/src/connection.rs` | writer task | 当收到 session_update tap 时，发送完整 Envelope |
| `crates/observer-surface` | 无改动 | 已能接收 tap_event |
| plugin | 无改动 | 仍发 target=this.address |

**注意**: 这是 **router 修复**，不是 Server-Management 修复。

### 5.5 验收判据

**第一次 session_update (session 创建)**:
- 触发: `oca create-session --model mimov2.5 --workspace test-workspace`
- observer log: `kind: "session_update"`, `sessionID` 存在，`state` 为 `"busy" | "idle" | "stopped" | "waiting"`

**第二次 session_update (消息处理)**:
- 触发: `control-surface --command addprompt --message "..."`
- observer log: `kind: "session_update"`, `sessionID` 存在，`state` 为 `"busy" | "idle" | "stopped" | "waiting"`

**observer log 检查字段**:
```json
{
  "type": "forward_peer",
  "summary": {
    "kind": "session_update",  ← 必须
    "source": "workspace-a/runtime-1/session-1",
    "target": "workspace-a/runtime-1/session-1"
  }
}
```

## 6. requestion 广播机制

### 6.1 语义说明

**Router 自动广播 `requestion.*` 给 ObserverSurface 和 RequestionSurface**

当 plugin 发送 `requestion.asked` 或 `requestion.response` 信封时，router 会自动 fan-out 给所有 ObserverSurface 和 RequestionSurface peer。

**关键约束**:
- Plugin 发送 `target=this.address`（路由目标）
- Router 检测 `kind` 以 `requestion.` 开头后，额外 fan-out 给 ObserverSurface 和 RequestionSurface
- RequestionSurface 通过本地 tap 接收并缓存

### 6.2 Router 职责边界

**Router 只做广播和转发，不 materialize 状态**:

| 职责 | Router | Plugin/Client | RequestionSurface |
|---|---|---|---|
| `session_update` 广播 | ✅ fan-out 给 ObserverSurface | - | - |
| `requestion.*` 广播 | ✅ fan-out 给 ObserverSurface/RequestionSurface | - | - |
| ReadRequest/ReadResponse 转发 | ✅ 按 target 路由 | - | - |
| SessionUpdateSnapshot 权威源 | ❌ | ✅ plugin 端是权威来源 | ❌ |
| RequestionSnapshot 缓存/回答 | ❌ | ❌ | ✅ 独立缓存视图 |
| session_update 状态 materialize | ❌ | ✅ plugin 端维护 | ❌ |
| requestion 状态 materialize | ❌ | ✅ plugin 端维护 | ✅ 缓存副本 |

**SessionUpdateSnapshot 链路**:
```
control/query surface → ReadRequest(op=session_update_snapshot)
  → router 转发 (按 target 路由)
  → opencode plugin/client (权威来源)
  → ReadResponse
```

**RequestionSnapshot 链路**:
```
control/query surface → ReadRequest(op=requestion_snapshot, target=RequestionSurface)
  → router 转发 (按 target 路由)
  → RequestionSurface (缓存视图)
  → ReadResponse
```

**关键约束**:
- SessionUpdateSnapshot 权威来源是 **opencode plugin 端**
- RequestionSurface 是**独立的缓存视图**，不是 router 内置状态
- Router 只做 `requestion.*` / `session_update` 广播和 `ReadRequest`/`ReadResponse` 转发
- Router 不 materialize session/requestion 状态

## 7. Wire Format

### 5.1 关键字段规范

| 字段 | 类型 | 说明 |
|---|---|---|
| `SessionEnvelope.id` | UUID (string) | 信封唯一标识，必须是有效 UUID |
| `SessionEnvelope.source` | SessionAddress | camelCase: `{domain, runtime?, session?}` |
| `SessionEnvelope.target` | SessionAddress | camelCase: `{domain, runtime?, session?}` |
| `SessionEnvelope.kind` | string | 信封类型: `session_update`, `session_command`, `requestion.*` 等 |
| `SessionEnvelope.payload` | JSON | 业务数据 |
| `SessionEnvelope.ttl` | number | 路由跳数，默认 32 |
| `SessionEnvelope.routeHops` | string[] | 已经过的节点 ID |
| `SessionEnvelope.originSurface` | string? | 控制命令来源 surface ID |

### 5.2 LinkMessage Serialization

```json
// Envelope (SessionEnvelope.id 必须是 UUID)
{
  "type": "envelope",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "source": { "domain": "workspace-a", "runtime": "rt-1", "session": "ses-1" },
    "target": { "domain": "workspace-b", "runtime": "rt-2", "session": "ses-2" },
    "kind": "session_update",
    "payload": { ... },
    "ttl": 32,
    "routeHops": [],
    "originSurface": null
  }
}

// ReadRequest
{
  "type": "read_request",
  "data": {
    "requestId": "uuid",
    "surfaceId": "control-surface-1",
    "traceId": "uuid",
    "target": { "domain": "workspace-b", "runtime": "rt-2", "session": "ses-2" },
    "operation": { "op": "list_workspaces", "includeSessions": true },
    "ttl": 32,
    "routeHops": []
  }
}

// ReadResponse
{
  "type": "read_response",
  "data": {
    "requestId": "uuid",
    "traceId": "uuid",
    "status": { "type": "ok" },
    "data": { ... },
    "responderNodeId": "target-node"
  }
}
```

### 5.3 Bridge 连接流程

```
1. WebSocket connect → router
2. Send Hello: {nodeId, role, addresses}  (无 type tag)
3. Receive HelloReply: {nodeId, role, addresses}  (无 type tag)
4. sendWorkspaceRegister()  ← 必须调用，注册工作区地址
5. 开始收发 LinkMessage
```

## 6. 首次验收命令

### 6.1 启动 Rust Router (复用 crates/router)

```bash
cargo run -p router -- --bind-addr 127.0.0.1:7240 --tap-capacity 128
```

### 6.2 启动 TS WS Client (workspace-a)

```bash
# 如果 TS client 已完成:
cargo run -p alpha-client -- --router-url ws://127.0.0.1:7240

# 如果 TS client 未完成，使用最小脚本:
node scripts/ws-client.js --workspace workspace-a --router ws://127.0.0.1:7240
```

### 6.3 启动 TS WS Client (workspace-b)

```bash
cargo run -p gamma-client -- --router-url ws://127.0.0.1:7240
```

### 6.4 发送测试消息

```bash
# 从 workspace-a 发送 session_command(add_prompt) 到 workspace-b
cargo run -p control-surface -- \
  --router-url ws://127.0.0.1:7240 \
  --target workspace-b/runtime-2/session-2 \
  --command addprompt \
  --message "Hello from workspace-a!" \
  --surface-id control-surface-1
```

## 7. 验收检查清单

- [ ] Router 启动并监听 127.0.0.1:7240
- [ ] TS Client A 连接成功，Hello 握手完成
- [ ] TS Client B 连接成功，Hello 握手完成
- [ ] Client A 发送 session_update，Client B 收到
- [ ] Client B 发送 `session_command(add_prompt)`，Client A 收到
- [ ] Control Surface 发送命令，目标 Client 收到
- [ ] ReadRequest/ReadResponse 跨域查询正常
- [ ] Observer Surface 可接收本地 tap 事件

## 8. 风险

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| TS Client 未完成 | 无法验证完整流程 | 使用 Rust client 模拟 |
| HelloReply 格式不匹配 | 连接失败 | 已在 observer-surface 修复 |
| tap_event JSON 解析 | Observer 无法接收事件 | 已在 observer-surface 修复 |
| 跨域路由未实现 | 跨 workspace 通信失败 | 首次验收限制在同一 router |

## 9. 文件结构

```
GlassVein/
├── crates/
│   ├── router/           # Rust router 内核 (复用)
│   ├── control/          # control-endpoint (was control-surface)
│   ├── viewer/           # surface-viewer (was observer-surface)
│   └── osgp/rust/        # osgp protocol (was session-links)
├── demos/
│   ├── alpha-client/     # 模拟 workspace-a
│   ├── gamma-client/     # 模拟 workspace-b
│   └── ...
└── docs/
    └── OPENCODE_ROUTER_BRIDGE.md  # 本文档
```

## 10. 关键设计原则

1. **复用优先**: opencode-router 直接使用 `router/`，不复制路由逻辑
2. **薄 wrapper**: 若保留 `opencode-router` crate，仅做 launcher + TS adapter
3. **TS adapter 层**: opencode 新增的部分只做协议转换，不涉及路由核心
4. **可连主网**: 端侧 router 可通过 upstream 连接主 GV 网络
5. **Surface 兼容**: observer-surface 和 control-surface 可直接连接端侧 router

## Canonical business wire after router boundary convergence

Business messages are filtered by top-level `type` and `subtype`; `kind` is not a business dispatch field.

- `type="upload"`: endpoint/plugin report. Current subtypes: `session_update`, `requestion_asked`, `requestion_resolved`, `requestion_updated`, `requestion_cancelled`.
  - Upload does not specify a business target and router does not route it through the route table by default.
  - Router may locally fan out upload to connected endpoint peers that self-declare opaque capability `surface_viewer` in Hello.
- `type="control"`: user-layer control command. Subtypes: `add_prompt`, `abort_session`, `compact_session`, `create_session`, `rename_session`, `resume_session`, optional `requestion_respond`.
- `type="request"`: read/query request. Subtypes: `list_workspaces`, `read_workspace_info`, `list_session_messages`, `session_update_snapshot`, `requestion_snapshot`, `runtime_requestion_snapshot`, `session_view_snapshot`, `session_update_subscribe`.
- `type="response"`: response to a request/control. `subtype` matches the request/control subtype and includes `request_id` or `correlation_id`.

Router Hello only distinguishes network role `router` vs `endpoint`. User-layer concepts such as control surface, observer surface, and requestion surface are endpoint/service concerns, not router roles. Endpoint Hello may include `capabilities: ["surface_viewer"]`; router only uses this weak tag for local upload fan-out.
