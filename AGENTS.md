# GlassVein 项目记忆

## 作用范围

- 适用于 `GlassVein/` 及其子目录。
- GlassVein 是独立 Rust/Cargo workspace，用于 OSGP (OpenSessionGateway Protocol) 路由架构。
- 新架构可完全脱离旧 OSG，不要求兼容旧 OSG 内部实现。

## 当前目录结构（canonical）

### OSGP 协议层

```text
osgp/rust/   → package `osgp` — Rust OSGP protocol crate
osgp/ts/     → @opensessiongateway/osgp — TypeScript OSGP types
```

- `osgp/rust/`：OSGP 地址、信封、link/wire message primitives；不依赖其他 workspace crate。
- `osgp/ts/`：TypeScript OSGP 类型与编解码；独立 npm 包。

### Rust 客户端 SDK

```text
clients/rust/ → package `osgp-client`
```

- 依赖 `osgp`。
- 模块结构：`transport`、`ws_transport`、`client`、`helpers`、`route`（含 `transport`、`local_route`）。

### Rust 核心链

```text
core/   → core crate（纯路由表、TTL/trace、next-hop/forward decision）
router/ → router crate（router runtime、邻居编排、连接管理）
```

- `core/`：只依赖 `osgp`，不包含 transport 实现或业务语义。
- `router/`：依赖 `osgp`、`core`，不依赖 client/surface 业务。

### Rust 端点（endpoints）

```text
endpoints/console/    → console-endpoint（人用 TUI，会话查看 + control/request）
endpoints/requestion/ → requestion-endpoint
```

- `endpoints/control/` 与 `endpoints/viewer/` 已由 `endpoints/console/` 取代；旧目录若存在只能保留 README redirect/历史说明，不应作为 Cargo workspace active endpoint。

### Rust Surface 库

```text
crates/surface/ → surface 库（observer + control + query）
```

### 已归档

- `crates/glassvein-opencode-router/` — 已移除，功能由 `integrations/opencode/plugin` 取代。
- `crates/control-surface/`、`crates/observer-surface/`、`crates/requestion-surface/` — 已迁移到 `endpoints/`。

### 集成层（integrations）

```text
integrations/opencode/plugin/ → @opensessiongateway/opencode-vein-plugin（TypeScript 插件）
integrations/osg/plugins/     → OSG MCP 插件（runtime-control、session-bridge、timer-scheduler、IM-gateway）
```

- `packages/glassvein-router/` 保留为 npm wrapper（内含 Rust 二进制 stage 脚本）。

### 其他

```text
demos/    → demo 二进制（alpha/beta/gamma-client + observer/control demo）
examples/ → OSGP 端点示例（osgp-rust-endpoint、osgp-ts-endpoint）
legacy/   → 已归档旧 glassvein-* crate（不在主 workspace 中）
```

## 依赖方向

```text
osgp (osgp/rust)
├── core
│   └── router
└── osgp-client (clients/rust)
    └── surface
```

## 命名历史

旧名映射已完成，参见 `docs/CRATE_BOUNDARIES.md` "Old → New name mapping" 节。

## 架构约束（用户决定）

- **Server runtime 使用 Pingora**：router/server 端核心运行时最终迁移到 Pingora；当前原型阶段使用 tokio + tokio-tungstenite。
- **Wire transport 统一 WebSocket**：所有节点间通信统一使用 WebSocket 协议。
- **OSGP 协议**：当前 wire 协议向 OSGP 收敛；角色只有 `endpoint` 和 `router`；业务 wire 只有 `upload`/`control`/`request`/`response` + subtype。
- **禁止恢复的旧协议概念**：`ObserverSurface`/`ControlSurface` 作为 router role、`kind` 字段、`control.command`、standalone `permission`/`question`、`opencode_event` 作为主链路 subtype、wire 字段 `surfaceId`/`surface_id`。`surface` crate 和 `surface-viewer` endpoint 是 SDK/应用层名称，不是 wire 角色。

## 工作规则

- 禁止引入 workspace crate 循环依赖。
- `core` 不理解 session 业务语义，只处理地址、信封、TTL、trace 与 next-hop。
- 新增 transport 时优先做 adapter，不要把具体网络库写死进 `core`。
- router 只负责跨连接、跨节点转发；同 runtime/session 的业务行为应在 client/surface 侧实现。
- 本地 npm 发布仅可保留结构或说明；不得在普通脚手架任务中实际发布。
- 不在本项目任务中执行部署、容器、服务器、Verdaccio 操作。
- `legacy/` 下的 crate 仅作历史参考，不要在主 workspace 中引用。
- 目录迁移由对应 owner worker 负责（core/router → GLM-1，endpoints → GLM-2/3/4），不交叉修改。

## 代码规范

- 单文件不超过 500 行（含测试）。超过时优先拆分为独立模块文件。
- Rust 测试代码应放入 `tests.rs` 子模块（`#[cfg(test)] mod tests;`），与实现分离。
- TypeScript 文件同样不超过 500 行；超过时拆分为 helper/子模块。
- `vendor/` 下为第三方代码，不适用此规则。
