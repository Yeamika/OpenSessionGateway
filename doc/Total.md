# OSG 代码与 API 总览

## 1.总体结构

### 1.1 服务端

- 目录：`server/`
- 作用：承载 HTTP API、WebSocket runtime 接入、MCP surface、插件宿主与插件管理接口。

关键代码入口：

- `server/server.ts`
- `server/app/api/v2/mcp/[surface]/route.ts`
- `server/app/api/v2/mcpsurfaces/route.ts`
- `server/lib/plugins/host.ts`
- `server/lib/plugins/mcp/registry.ts`
- `server/lib/admin-server/index.ts`

### 1.2 协议与客户端

- 客户端插件目录：`packages/client-opencode-plugin-v2/`
- 客户端基础库目录：`packages/client-library/`
- 协议目录：`packages/protocol-library/`

关键代码入口：

- `packages/client-opencode-plugin-v2/index.ts`
- `packages/client-opencode-plugin-v2/lib/config.ts`
- `packages/client-opencode-plugin-v2/lib/mcp.ts`
- `packages/client-opencode-plugin-v2/lib/OSG-opencode/manager.ts`

说明：

- 当前实际链路分为两层：
  - `c-s`：客户端与服务端之间的运行时链路。
  - `s-MCP`：服务端对外暴露的 MCP surface。
- `s-MCP` 上的控制参数不应默认透传到 `c-s`。
- `packages/client-opencode-plugin-v2/lib/OSG-opencode/index.ts`

### 1.3 服务端插件

- 目录：`plugins/`
- 当前重点插件：
  - `runtime-control`
  - `session-bridge`

## 2.公开 API

### 2.1 Surface 发现

路径：`GET /api/v2/mcpsurfaces`

代码：`server/app/api/v2/mcpsurfaces/route.ts`

返回：

- `ok`
- `surfaces`
- `plugins[{ id, routeSegments }]`

用途：

- 让客户端在公开 API 上发现当前可用的 MCP surface。
- 不再依赖 admin 端口进行 surface discovery。

### 2.2 MCP Surface 统一入口

路径：`GET/POST /api/v2/mcp/[surface]`

代码：`server/app/api/v2/mcp/[surface]/route.ts`

行为：

- `GET` 返回 surface 的 `info()`。
- `POST` 转发 JSON-RPC 请求到对应插件的 `handleRpc()`。

### 2.3 插件管理接口

路径：

- `GET /api/plugins`
- `POST /api/plugins/load`
- `POST /api/plugins/unload`
- `POST /api/plugins/reload`
- `POST /api/plugins/autoload`
- `POST /api/plugins/autoload/apply`

代码：`server/lib/admin-server/index.ts`

说明：

- 这组接口属于插件管理面。
- `load` 同时支持：
  - `{ path }`
  - `{ packageName }`

## 3.插件宿主

核心代码：`server/lib/plugins/host.ts`

职责：

- 维护插件注册表与 surface 注册表。
- 维护插件来源类型。
- 动态加载、卸载、重载插件。
- 通过 worker runtime 为插件提供统一宿主上下文。

### 3.1 插件来源类型

定义位置：`server/lib/plugins/host.ts`

当前支持：

- `builtin`
- `file`
- `package`

说明：

- `file`：从本地目录或源码路径加载。
- `package`：从当前运行目录 `node_modules` 中按包名解析后加载。

### 3.2 插件 worker runtime

代码：`server/lib/plugins/worker-runtime.mjs`

职责：

- 在 worker 中加载插件模块。
- 为插件提供：
  - `mcp.registerSurface`
  - `osg.*`
  - `storage.*`
  - hooks
- 把插件对宿主的调用转成 `host_request`。

## 4.插件自动加载配置

代码：`server/lib/plugins/mcp/registry.ts`

配置文件：`osg.plugins.json`

当前支持两类配置：

- 目录扫描控制：`allow` / `deny`
- 显式条目：`entries`

示例：

```json
{
  "autoload": {
    "allow": ["runtime-control"],
    "entries": [
      { "type": "package", "spec": "@opensessiongateway/osg-plugin-session-bridge" },
      { "type": "path", "spec": "./local-plugins/runtime-control" }
    ]
  }
}
```

说明：

- `type: "package"`：按 npm 包名加载。
- `type: "path"`：按本地目录加载。

## 5.客户端运行链路

### 5.1 插件入口

代码：`packages/client-opencode-plugin-v2/index.ts`

职责：

- 创建 `OSGOpencodeClient`
- 在 `config()` 钩子中注入 OSG MCP 配置
- 在 `event()` 钩子中转发 OpenCode 事件
- 在 `cleanup()` 中停止客户端

### 5.2 运行配置

代码：`packages/client-opencode-plugin-v2/lib/config.ts`

读取优先级：

- `process.env`
- `./.config/opensessiongateway-config.json`
- `~/.config/opensessiongateway-config.json`

关键字段：

- `baseUrl`
- `wsUrl`
- `logDir`

### 5.3 MCP 注入

代码：`packages/client-opencode-plugin-v2/lib/mcp.ts`

职责：

- 从 `wsServerUrl/baseUrl` 推导 MCP 基址。
- 请求 `/api/v2/mcpsurfaces` 获取 surface 列表。
- 生成 `cfg.mcp` 中的 remote 配置。
- 当前主要注入：
  - `runtime_control`
  - `session_bridge`

## 6.当前重点控制域

### 6.1 Runtime / Session / Workspace

- 由 `runtime-control` 负责。
- OSG 负责收集信息、监视状态和路由控制命令。
- Session 的真实生命周期仍由客户端托管。

### 6.2 Mailbox / Session Bridge

- 由 `session-bridge` 负责。
- 提供跨 session 的消息投递、读取与回复能力。

### 6.3 Permission / Question

- OpenCode 自身已经有独立状态机。
- OSG 侧的设计目标是提供统一控制面，而不是接管这些状态机。

## 7.参数分层规则

- `c-s` 只传客户端执行命令所必需的最小参数。
- `s-MCP` 可以承载服务端控制面参数，例如执行归属、认证和策略上下文。
- 这类控制层参数应由服务端消费，不应无条件透传到客户端协议。
- 例如 `CreateNewSession.ExecutorSessionID` 只属于 `runtime_control` 这一层，不属于下游 ws 创建 session 协议。
