# GlassVein 项目记忆

## 作用范围

- 适用于 `GlassVein/` 及其子目录。
- GlassVein 是独立的新项目目录，用于实验和沉淀 OSG 风格的分层会话路由核心。

## 当前定位

- `crates/glassvein-protocol/`：路由地址、信封与线协议类型。
- `crates/glassvein-core/`：路由表、next-hop 与转发决策核心。
- `crates/glassvein-router/`：WebSocket 路由节点与 demo 客户端运行时。
- `crates/glassvein-router-cli/`：正式 `glassvein-router` CLI binary，用于 npm 二进制包分发。
- `crates/glassvein-pingora/`：Pingora ingress/data-plane 适配层。
- `examples/tree-demo/`：三节点树状网络互通 demo。
- `examples/surface-demo/`：多 client / surface 的树内最短路径 demo。
- `examples/pingora-surface-demo/`：所有接入先经过 Pingora ingress 的树内最短路径 demo。
- `examples/multi-upstream-demo/`：验证单个 router 同时连接两个 upstream，并服务多个 downstream。
- `packages/glassvein-router/`：npm wrapper 包，包名 `glassvein-router`，只打包 `win32-x64`、`linux-x64`、`linux-arm64` 三个目标二进制。
- `vendor/pingora/`：本地克隆的 Pingora 评估副本，默认不纳入 GlassVein 源码版本控制。

## 工作规则

- GlassVein core 不理解 session 业务语义，只处理 `RouteEnvelope`、地址、TTL、trace 与 next-hop。
- 同 runtime/session 的业务行为应在 client 侧实现；router 只负责跨连接、跨节点转发。
- 新增 transport 时优先做 adapter，不要把具体网络库写死进 `glassvein-core`。
- Pingora 负责连接层 ingress/upstream 选择；`domain/runtime/session` 最短路径仍归 GlassVein core。
- router 间路由通告是双向相邻通告；发送给某邻居时使用 split horizon，避免把从该邻居学到的路由原样通告回去。
