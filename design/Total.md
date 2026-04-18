# 1.核心目标

- 建立统一的 runtime 接入层。
- 建立统一的 session 可见性与路由层。
- 建立统一的控制入口，屏蔽具体 runtime 实现差异。
- 通过插件化方式扩展服务端能力与桥接能力。
- 支持以独立 npm 包方式部署客户端、服务端和插件。

# 2.模块规划

## 2.1 核心

- OSG 的核心，定义 runtime、session、workspace 等基础对象，以及它们的状态模型、路由规则和运行期基础能力。

### 2.1.1 服务器

- 目录：`server/`
- 运行 OSG 主服务，承载 HTTP、WebSocket、MCP surface 和服务端插件装载。

### 2.1.2 传输协议

- 目录：`packages/protocol-library/`
- 定义客户端与服务端之间的共享协议和消息结构。

## 2.2 插件系统

- 定义插件装载、注册和运行期集成机制。

### 2.2.1 插件sdk

- 目录：`packages/server-plugin-sdk/`
- 定义服务端插件接口与注册方式。

### 2.2.2 插件

- 目录：`plugins/`
- 在 OSG 核心之上扩展控制面能力。

## 2.3 客户端

- 承载客户端侧通用能力、具体实现和前端界面。

### 2.3.1 客户端库

- 目录：`packages/client-library/`
- 封装客户端连接、日志、WebSocket 通信等通用能力。

### 2.3.2 各客户端实现

- 目录：`packages/client-opencode-plugin-v2/`
- 承载具体客户端接入实现，负责把实际运行端能力接入 OSG。

### 2.3.3 前端

- 目录：`web/`
- 提供 OSG 的展示与交互界面。
