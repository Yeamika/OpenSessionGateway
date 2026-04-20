# 客户端代码与 API

## 1.代码入口

- `packages/client-opencode-plugin-v2/index.ts`
- `packages/client-opencode-plugin-v2/lib/config.ts`
- `packages/client-opencode-plugin-v2/lib/mcp.ts`
- `packages/client-opencode-plugin-v2/lib/mcp-urls.ts`
- `packages/client-opencode-plugin-v2/lib/OSG-opencode/index.ts`
- `packages/client-opencode-plugin-v2/lib/OSG-opencode/manager.ts`
- `packages/client-opencode-plugin-v2/lib/OSG-opencode/ws-event/*.ts`

## 2.插件生命周期

入口：`packages/client-opencode-plugin-v2/index.ts`

插件对 OpenCode 暴露：

- `config(config)`
- `tool`
- `event({ event })`
- `cleanup()`

职责：

- 启动 OSG 客户端连接
- 注入 OSG MCP 配置
- 消费 OpenCode 事件并上报状态
- 接收来自 OSG 的控制消息

## 3.运行配置

代码：`packages/client-opencode-plugin-v2/lib/config.ts`

优先读取：

- `OSG_BASE_URL`
- `OSG_WS_URL`
- `OSG_RUNTIME_ID`
- `OSG_LOG_DIR`
- `./.config/opensessiongateway-config.json`
- `~/.config/opensessiongateway-config.json`

默认回退：

- `ws://127.0.0.1:4088/api/v2/wsport`

## 4.MCP 发现与注入

代码：`packages/client-opencode-plugin-v2/lib/mcp.ts`

当前 discovery 流程：

1. 从 `baseUrl/wsServerUrl` 推导 MCP 基址。
2. 请求 `GET /api/v2/mcpsurfaces`。
3. 根据返回的 `surfaces` 生成 remote MCP 配置。
4. 把 `runtime_control`、`session_bridge` 等 surface 注入到 `cfg.mcp`。

关键函数：

- `deriveMcpBaseUrl()`
- `deriveSurfaceDiscoveryUrl()`
- `discoverRouteSegments()`
- `buildOsgMcpConfig()`
- `applyOsgMcpConfig()`

## 5.WebSocket 客户端

核心代码：

- `packages/client-opencode-plugin-v2/lib/OSG-opencode/index.ts`
- `packages/client-opencode-plugin-v2/lib/OSG-opencode/manager.ts`

职责：

- 建立与 OSG 的 WebSocket 连接
- 维护 runtimeID、hostName、workspace 等运行期信息
- 管理实例注册与状态上报
- 处理来自服务端的 ws 控制事件

## 6.服务端事件处理

目录：`packages/client-opencode-plugin-v2/lib/OSG-opencode/ws-event/`

当前可见处理器包括：

- `CreateNewSession.ts`
- `RequestRuntime.ts`
- `AddPromot.ts`
- `GetSessionMsg.ts`
- `RenameSessionOfClient.ts`
- `SetClientDisplaySession.ts`
- `AbortSessionOfClient.ts`
- `RequestInstanceWorkspaceReload.ts`
- `ListAvailableModels.ts`
- `ListLastUsedModelOfSession.ts`
- `Permission.ts`
- `ShowToast.ts`

说明：

- 这些文件对应 OSG 服务端发到客户端的控制消息。
- 客户端收到后调用 OpenCode 本地能力执行。

## 7.状态上报

关键代码：

- `CurrentClientInfo.ts`
- `ClientContentExecuteing.ts`
- `SessionList.ts`

职责：

- 上报 runtime 基础信息
- 上报 session 状态与标题
- 上报 workspace 与 display 信息
- 触发 OSG 侧的 runtime / session 视图更新

## 8.客户端边界

- 客户端维护真实 runtime、session、permission、question 状态。
- OSG 不接管这些状态机。
- OSG 只通过公开 API 和 WebSocket 链路进行观测与控制。

## 9.通讯分层约束

- `c-s`：客户端与服务端之间的运行时链路。
- `s-MCP`：服务端对外暴露的 MCP 控制入口。
- 客户端只处理 `c-s` 所需的最小执行参数。
- 例如 `ExecutorSessionID` 这种控制层参数，只应存在于 `s-MCP`，不应进入客户端 ws 执行协议。
