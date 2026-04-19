# 服务端插件系统

## 1.代码入口

核心宿主：

- `server/lib/plugins/host.ts`
- `server/lib/plugins/worker-runtime.mjs`
- `server/lib/plugins/mcp/registry.ts`
- `server/lib/admin-server/index.ts`

## 2.插件对象模型

插件通过 `@opensessiongateway/server-plugin-sdk` 暴露：

- `manifest`
- `activate(context)`

关键 SDK 入口：

- `packages/server-plugin-sdk/src/index.ts`

宿主给插件提供的上下文包括：

- `mcp.registerSurface`
- `osg.*`
- `storage.*`
- `hooks.*`

## 3.加载方式

### 3.1 目录加载

- 通过本地目录或源码目录加载。
- 适用于开发与联调。

### 3.2 npm 包加载

- 通过插件包名加载。
- 宿主从当前运行目录的 `node_modules` 中解析入口。
- 适用于部署环境。

## 4.自动加载

配置文件：`osg.plugins.json`

支持：

- `allow`
- `deny`
- `entries`

`entries` 支持：

- `type: "path"`
- `type: "package"`

## 5.管理 API

管理接口代码：`server/lib/admin-server/index.ts`

主要接口：

- `GET /api/plugins`
- `POST /api/plugins/load`
- `POST /api/plugins/unload`
- `POST /api/plugins/reload`
- `POST /api/plugins/autoload`
- `POST /api/plugins/autoload/apply`

加载请求体支持：

```json
{ "path": "/abs/or/relative/plugin/path" }
```

或：

```json
{ "packageName": "@opensessiongateway/osg-plugin-runtime-control" }
```

## 6.公开 surface 发现

路径：`GET /api/v2/mcpsurfaces`

代码：`server/app/api/v2/mcpsurfaces/route.ts`

作用：

- 向客户端公开当前可用的 MCP surface 列表。
- 不依赖 admin 端口进行运行时发现。
