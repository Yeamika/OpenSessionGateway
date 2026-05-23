<!-- historical / pre-cleanup: paths reference pre-migration layout (crates/core, crates/router) -->
# Pingora / Core Transport 迁移计划 — 分阶段方案

## 1. 目标

### 用户目标

- **Core 使用 Pingora** 作为 server runtime，替代当前 `tokio::net::TcpListener`。
- **Router 逐步接入 core Pingora transport**，通过 core 提供的 `Transport` / `TransportFactory` trait 承载流量。
- **Wire 协议不变**：所有节点间通信仍使用 WebSocket + `LinkMessage` JSON。
- **不涉及部署**：本文档不含生产部署、容器构建、npm 发布、服务器运维步骤。

### 协作约束

- 子 agent 之间不互相通讯，阶段由 Manager 串联调度。
- 每阶段有独立的 PARTIAL / PASS 判据，前一阶段 PASS 是后续阶段的前提。
- 文档改动和代码改动分阶段由不同 worker 执行；文档 worker 不改 Rust 代码。

### 不变约束（贯穿所有阶段）

| 约束 | 说明 |
|---|---|
| Core 业务无关 | core crate 不引入 requestion / session_update / opencode / permission / question 语义 |
| tokio-tungstenite 保留 | 可作为 WebSocket handshake/frame codec；Pingora 负责 TCP listener/runtime |
| 上游 connect_async 保留 | Router 上游连接可阶段性使用 `tokio_tungstenite::connect_async`，不阻塞下游迁移 |
| 不涉及部署 | 不含部署/发布/容器步骤 |
| Wire 协议不变 | Hello / Envelope / ReadRequest / ReadResponse 格式不变 |

---

## 2. 当前状态基线

### Core（`crates/core`）

```
✅ RouteTable / NextHop / ForwardDecision
✅ ForwardEngine
✅ Transport trait (send / recv / close)
✅ TransportFactory trait (accept / connect)
✅ InMemoryTransport (单测 mock)
✅ TransportMap
✅ PingoraTransport        (feature: pingora-transport)  — Phase A 审计 PASS
✅ PingoraServerApp         (feature: pingora-transport)  — Phase A 审计 PASS
✅ PingoraTransportFactory  (feature: pingora-transport)  — Phase A 审计 PASS
✅ build_pingora_service()  (feature: pingora-transport)  — Phase A 审计 PASS
```

- `crates/core/Cargo.toml`：`[features] default = []`，`pingora-transport` 是可选 feature。
- 启用后引入：`pingora-core 0.8.0`、`tokio-tungstenite`、`futures-util`（均 optional）。
- `crates/core/src/transport/mod.rs`：通过 `#[cfg(feature = "pingora-transport")]` 条件编译 `pingora` 子模块。
- `PingoraTransportFactory::connect()` 显式 bail — server-side only 设计。
- Core 无 requestion / session_update / opencode / permission / question 语义泄漏。

### Router（`crates/router`）

```
✅ link_io.rs: WireFrame / FrameSink / FrameReader seam 已落地（Phase A 成果）
✅ TungsteniteFrameSink / TungsteniteFrameReader — 默认适配器
⚠️ listener.rs: tokio::net::TcpListener + accept loop，未接入 Pingora
⚠️ upstream.rs: connect_async 直连，未走 TransportFactory
⚠️ Cargo.toml: 无 [features] section，未启用 pingora-listener
```

- Router 直接依赖 `tokio-tungstenite`（workspace 级）。
- `ConnectionManager::start_listener()` 直接 bind `TcpListener`。
- `ConnectionManager::connect_upstream()` 直接调用 `connect_async(url)`。
- **新增 `link_io.rs`** 提供了 `WireFrame` 抽象 + `FrameSink` / `FrameReader` trait，
  是 Pingora 接入点（Pingora 适配器实现 `FrameSink` / `FrameReader` 即可）。

### Feature 矩阵

| Crate | Feature | 默认 | 状态 |
|---|---|---|---|
| `core` | `pingora-transport` | 关闭 | ✅ 已配置，Phase A PASS |
| `router` | `pingora-listener` | — | ❌ 需新增（Phase B 目标） |
| `session-links` | （无 features） | — | ✅ 无网络依赖 |

### Router connection 模块当前结构

```
crates/router/src/connection/
├── mod.rs          # ConnectionManager 定义
├── config.rs       # ListenerConfig / UpstreamConfig
├── link_io.rs      # WireFrame / FrameSink / FrameReader seam ← Phase A 新增
├── listener.rs     # TcpListener + accept loop
├── upstream.rs     # connect_async 直连
├── peer.rs         # peer 读写循环
├── dispatch.rs     # 消息分发
├── writer.rs       # 旧 writer（link_io 替代）
└── tests.rs        # 连接测试
```

---

## 3. Phase A — Core Adapter Contract 审计 / Baseline 确认 ✅ PASS

### 目标

确认 core Pingora adapter API contract，审计 router seam 设计，完成 build matrix 验证，
建立稳定基线。

### 结果：全部 PASS

| 审计项 | 结果 |
|---|---|
| A1 PingoraTransport 实现 Transport trait | ✅ PASS |
| A2 PingoraServerApp 实现 ServerApp | ✅ PASS |
| A3 PingoraTransportFactory 实现 TransportFactory | ✅ PASS |
| A4 connect() 返回 bail (server-side only) | ✅ PASS |
| A5 Feature gate 隔离 | ✅ PASS |
| A6 Core 无业务语义泄漏 | ✅ PASS |
| A7 单元测试覆盖 trait bounds | ✅ PASS |
| A8 build_pingora_service() 返回类型正确 | ✅ PASS |

### Phase A 交付物

1. **Core Pingora adapter contract PASS** — `PingoraTransport`、`PingoraServerApp`、
   `PingoraTransportFactory`、`build_pingora_service()` 全部审计通过，API contract 稳定。
2. **Router seam design PASS** — `connection/link_io.rs` 落地，提供：
   - `WireFrame`：transport-agnostic text frame 抽象
   - `FrameSink` trait：发送端接入点
   - `FrameReader` trait：接收端接入点
   - `TungsteniteFrameSink` / `TungsteniteFrameReader`：默认 tungstenite 适配器
   - `split_tungstenite_ws()`：默认 split 函数
3. **ForwardEngine gap analysis PASS** — ForwardEngine 在 core 中存在且可用，
   但 router 目前部分绕过 ForwardEngine 直接处理消息（Phase D 收敛目标）。
4. **Build matrix PASS** — `cargo check -p core --features pingora-transport` 通过；
   无 feature 时不引入 pingora/tokio-tungstenite。
5. **Baseline acceptable** — 所有 Phase A 判据满足，可进入 Phase B。

### 验收命令（已通过）

```bash
cargo check -p core --features pingora-transport    # ✅
cargo test -p core --features pingora-transport     # ✅
cargo tree -p core | grep -E "pingora|tokio-tungstenite"  # ✅ 无 feature 时无匹配
grep -r "requestion\|session_update\|opencode\|permission\|question" crates/core/src/  # ✅ 无匹配
cargo check -p router                               # ✅
cargo test --workspace                               # ✅
```

---

## 4. Phase B — Router Pingora 接入准备（当前阶段）

### 目标

在 router 中完成 Pingora 接入的 plumbing 工作，为 Phase C 的 feature-gated
Pingora listener 原型建立编译和 feature 基础。

### 范围

- 涉及 `crates/router`（`Cargo.toml`、connection 模块）和 `crates/core`（transport API）。
- **不改 ForwardEngine**；不能直接跳到全链路收敛。
- **不改 Wire 协议**。
- 上游 `connect_async` 不动。

### Phase B 子任务

#### B1 — Core PingoraTransport raw text frame API

确保 core `PingoraTransport` 的 `send` / `recv` 与 router `WireFrame` 兼容。

当前 core `PingoraTransport` 直接序列化/反序列化 `LinkMessage` JSON。
Router `link_io.rs` 使用 `WireFrame`（raw text frame）。

**需要确认**：
- core `PingoraTransport::send()` 接受 `LinkMessage`，内部序列化为 JSON text。
- router `WireFrame` 携带 JSON text。
- 两者是否需要桥接层，还是 router 直接通过 core `Transport` trait 交互。
- **方向**：router 的 `FrameSink` 适配器实现 core `Transport` trait，或者
  core `PingoraTransport` 内部暴露 raw frame API。

**判据**：
- [ ] core `PingoraTransport` 与 router `WireFrame` / `FrameSink` / `FrameReader` 的关系明确
- [ ] 如需 API 调整，已完成并编译通过
- [ ] `cargo check -p core --features pingora-transport` 通过
- [ ] `cargo test -p core --features pingora-transport` 通过

#### B1b — Router `pingora-listener` feature plumbing

在 router `Cargo.toml` 中引入 `pingora-listener` feature，使 router 可以
条件编译 Pingora 路径。

**具体步骤**：
1. Router `Cargo.toml` 新增 `[features]` section 和 `pingora-listener` feature
2. `pingora-listener` 启用 `gv-core/pingora-transport`
3. Router connection 模块新增 `#[cfg(feature = "pingora-listener")]` 条件编译模块
4. 默认编译（无 feature）行为完全不变

**Feature 配置**：

```toml
# crates/router/Cargo.toml — 目标
[features]
default = []
pingora-listener = ["gv-core/pingora-transport"]
```

**Feature 透传关系**：

```
router feature: pingora-listener
  └── enables: gv-core/pingora-transport
                 ├── pingora-core 0.8.0
                 ├── tokio-tungstenite
                 └── futures-util
```

**判据**：
- [ ] Router `Cargo.toml` 存在 `[features]` section
- [ ] Feature `pingora-listener` 存在且启用 `gv-core/pingora-transport`
- [ ] `cargo check -p router`（无 feature）编译通过
- [ ] `cargo check -p router --features pingora-listener` 编译通过
- [ ] `cargo test -p router`（无 feature）测试通过
- [ ] `cargo tree -p router`（无 feature）不含 pingora
- [ ] `cargo tree -p router --features pingora-listener` 包含 pingora-core

### Phase B 整体判据

#### PARTIAL

- [ ] B1 API 兼容性确认完成
- [ ] Router `Cargo.toml` 有 `pingora-listener` feature
- [ ] `cargo check -p router --features pingora-listener` 编译通过
- [ ] `cargo test -p router`（无 feature）通过
- [ ] Wire 协议不变

#### PASS

- [ ] 上述 PARTIAL 全部满足
- [ ] Router 有 `#[cfg(feature = "pingora-listener")]` 条件编译骨架
- [ ] `cargo test --workspace` 全量通过
- [ ] `cargo test --workspace --features "gv-core/pingora-transport"` 通过
- [ ] 运行时行为与当前一致（默认 feature 不引入 Pingora）

### 验收命令

```bash
# B1 — core API
cargo check -p core --features pingora-transport
cargo test -p core --features pingora-transport

# B1b — router feature plumbing
cargo check -p router
cargo check -p router --features pingora-listener
cargo test -p router
cargo tree -p router | grep "pingora" && echo "FAIL" || echo "PASS"
cargo tree -p router --features pingora-listener | grep "pingora" && echo "PASS" || echo "FAIL"

# 全量
cargo test --workspace
cargo test --workspace --features "gv-core/pingora-transport"

# Core 业务无关守卫
grep -r "requestion\|session_update\|opencode\|permission\|question" crates/core/src/ \
  && echo "FAIL" || echo "PASS"
```

### 明确不做

- ❌ 不直接跳到 ForwardEngine 全收敛 — ForwardEngine 是长期 Phase D 目标。
- ❌ 不改 Wire 协议。
- ❌ 不改上游 `connect_async` 路径。
- ❌ 不部署、不发布、不容器。

---

## 5. Phase C — Feature-Gated Pingora Listener 原型（Phase B PASS 后）

### 目标

Router 启用 `pingora-listener` feature 后，下游 listener 使用 core
`PingoraTransportFactory`。**不启用时行为与 Phase B 完全一致。**

### 范围

- 涉及 `crates/router` connection 模块的 listener 路径。
- 不改 core transport API。

### 设计要点

1. Router 新增 `PingoraFrameSink` / `PingoraFrameReader` 实现 `FrameSink` / `FrameReader` trait。
2. 新增 `PingoraListener` 封装 `PingoraServerApp::new()` + `PingoraTransportFactory::accept()`。
3. `PingoraListener` 内部将 `PingoraTransport`（core `Transport` trait）桥接到
   router 的 `FrameSink` / `FrameReader`。
4. Router 启动时根据 `cfg!(feature = "pingora-listener")` 选择 `LegacyListener` 或 `PingoraListener`。
5. 上游 `connect_async` 不变。

### PARTIAL 判据

- [ ] Router 有 `PingoraFrameSink` 实现 `FrameSink`（`#[cfg(feature = "pingora-listener")]`）
- [ ] Router 有 `PingoraFrameReader` 实现 `FrameReader`（`#[cfg(feature = "pingora-listener")]`）
- [ ] `cargo check -p router --features pingora-listener` 编译通过
- [ ] `cargo check -p router`（无 feature）仍编译通过

### PASS 判据

- [ ] 上述 PARTIAL 全部满足
- [ ] Router 可通过 `--features pingora-listener` 启动 Pingora listener
- [ ] Pingora listener 路径完成 Hello 握手
- [ ] `cargo test -p router --features pingora-listener` 通过
- [ ] Wire 协议不变
- [ ] 上游 `connect_async` 未被修改

### 验收命令

```bash
# 无 feature — 行为不变
cargo check -p router
cargo test -p router

# 有 feature — Pingora listener
cargo check -p router --features pingora-listener
cargo test -p router --features pingora-listener

# 全量
cargo test --workspace
cargo test --workspace --features "gv-core/pingora-transport"
```

### Pingora 真接入本地 PASS 后的后续步骤

Phase C PASS 后，Manager 会启动 GPT worker 请求部署/链路测试。
这不属于本文档的 Phase C 范围，而是 Manager 的调度决策。

---

## 6. Phase D — ForwardEngine / 全链路收敛（长期）

### 目标

Router 所有流量（下游 + 上游）通过 core `ForwardEngine` + `Transport` 抽象处理，
不再有任何绕过 core transport 的路径。

### 范围（待 Phase C PASS 后细化）

Phase D 是长期方向，当前只记录已知方向，不设具体 PASS 判据。
**不能跳过 Phase B / C 直接进入 Phase D。**

### 已知方向

1. **上游连接抽象**：`connect_async` 最终需要替换为 `TransportFactory::connect()` 实现。
   - 可能需要新增 client-side transport（非 Pingora，因为 PingoraTransportFactory 是 server-side only）。
   - 上游连接可能继续使用 tokio-tungstenite，但通过 core adapter 包装。
2. **ForwardEngine 接管**：Router 中所有直接消息处理路径收敛到 ForwardEngine。
3. **tokio-tungstenite 依赖降级**：从 router 直接依赖 → 通过 core 间接依赖。
4. **Router 本地 seam trait 收敛**：评估是否直接使用 core `TransportFactory` 而非 router 本地 `FrameSink` / `FrameReader`。

### 前置条件

- Phase C PASS。
- Core Transport / TransportFactory API 稳定。
- Router seam 抽象经过 Phase C 验证。

---

## 7. 跨阶段守卫

每阶段必须通过的检查（不依赖阶段编号）：

```bash
# Core 业务无关（所有阶段）
grep -r "requestion\|session_update\|opencode\|permission\|question" crates/core/src/ \
  && echo "FAIL: core has business semantics" || echo "PASS: core clean"

# session-links 无网络依赖（所有阶段）
cargo tree -p session-links | grep -E "tokio-tungstenite|pingora" \
  && echo "FAIL" || echo "PASS"

# Wire 协议不变（所有阶段）
cargo test --workspace
```

### 阶段依赖关系

```
Phase A PASS ✅  →  Phase B 进行中
Phase B PASS     →  Phase C 可开始
Phase C PASS     →  Phase D 可细化
```

---

## 8. 已有实现参考

### Core Cargo.toml Feature 配置

```toml
# crates/core/Cargo.toml
[features]
default = []
pingora-transport = ["pingora-core", "tokio-tungstenite", "futures-util"]

[dependencies]
pingora-core = { version = "0.8.0", optional = true }
tokio-tungstenite = { workspace = true, optional = true }
futures-util = { workspace = true, optional = true }
```

### Core Transport 模块结构

```
crates/core/src/transport/
├── mod.rs          # Transport + TransportFactory trait
│                   # InMemoryTransport (单测)
│                   # TransportMap
│                   # #[cfg(feature = "pingora-transport")] mod pingora
└── pingora.rs      # PingoraTransport / PingoraServerApp /
                    # PingoraTransportFactory / build_pingora_service
```

### Router link_io.rs Seam（Phase A 交付）

```rust
// 关键类型
pub struct WireFrame { text: String }

pub trait FrameSink {
    fn send_frame(&mut self, frame: WireFrame)
        -> Pin<Box<dyn Future<Output = Result<(), anyhow::Error>> + Send + '_>>;
}

pub trait FrameReader {
    fn next_text_frame(&mut self)
        -> Pin<Box<dyn Future<Output = Option<Result<WireFrame, anyhow::Error>>> + Send + '_>>;
}

// 默认 tungstenite 适配器
pub struct TungsteniteFrameSink<W> { ... }
pub struct TungsteniteFrameReader<S> { ... }
pub fn split_tungstenite_ws(ws) -> (TungsteniteFrameSink, TungsteniteFrameReader)
```

Pingora 适配器需要实现 `FrameSink` + `FrameReader`，替代 `TungsteniteFrameSink` / `TungsteniteFrameReader`。

### Router Cargo.toml（当前 — 无 features）

```toml
# crates/router/Cargo.toml — 当前状态
# 无 [features] section
# 直接依赖 tokio-tungstenite（workspace 级）
# 依赖 gv-core（workspace 级）
```

---

## 9. 不涉及的内容

- 生产部署步骤
- 性能基准测试
- 容器镜像构建
- npm / Verdaccio 发布
- 服务器运维操作
