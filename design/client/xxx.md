# 客户端设计

## 1.定位

- 客户端负责把具体 runtime 接入 OSG。
- 客户端负责维护真实 runtime、session、permission、question 状态。
- OSG 只观察和控制，不接管客户端状态机。

## 2.Session 边界

- Session 属于客户端托管。
- Session 的创建、执行、终止、消息流转都由客户端负责。
- OSG 只接收客户端上报的 session 信息，并向客户端下发控制命令。

## 3.Permission 链路

- 当客户端内部出现 pending permission 时，客户端负责上报给 OSG。
- 当 OSG 发出 resolve 指令时，客户端负责调用本地 Permission 机制完成真正处理。

## 4.Question 链路

- 当客户端内部出现 pending question 时，客户端负责上报给 OSG。
- 当 OSG 发出 reply 指令时，客户端负责调用本地 Question 机制完成真正处理。

## 5.MCP 与控制面

- 客户端通过公开 surface 发现 OSG 提供的控制面。
- 客户端将 `runtime-control`、`session-bridge` 等 surface 注入为可调用 MCP 工具。
- 客户端执行工具前后的真实行为仍由本地 runtime 决定。

## 6.通讯分层约束

- `c-s`：客户端与服务端之间的运行时协议链路。
- `s-MCP`：服务端对外暴露的 MCP 控制入口。
- 客户端只消费 `c-s` 所需的最小执行参数。
- 来自 `s-MCP` 的额外控制参数不应直接透传进 `c-s`。
- 执行归属、鉴权和策略相关上下文属于 `s-MCP`，不属于客户端运行时协议。
