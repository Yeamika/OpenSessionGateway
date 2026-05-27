# IM Endpoint 记忆

## 作用范围

- 适用于 `GlassVein/endpoints/im/` 及其子目录。
- 这是 GlassVein IM 端点，提供 MCP 兼容的 JSON-RPC API、GlassVein WebSocket 连接、配置驱动的 IM 账户运行时和 Web 前端。

## 架构定位

- **角色：** OSGP `role: "endpoint"`，连接 GlassVein router。
- **职责边界：**
  - 拥有：HTTP API 服务器、GV WebSocket 连接、IM 账户/聊天/路由状态管理、Web 前端资源。
  - 不拥有：核心路由决策、router 内部实现、OSGP 协议定义、Rust client SDK。

## 目录结构

```text
src/main.rs         入口：CLI 解析、GvClient 启动、API 服务
src/config.rs       CLI 配置（--http, --router-url, --config 等）
src/im_config.rs    JSON 配置 schema、凭据掩码、账户模板
src/feishu.rs       飞书/Lark token 验证与 smoke 测试
src/provider.rs     IM provider 类型（local、feishu）及配置规范化
src/gv.rs           GlassVein WebSocket 客户端（OSGP envelope 收发）
src/api.rs          HTTP/MCP JSON-RPC API 路由与静态 Web 服务
src/state/          状态管理模块
  model.rs          AppState 核心模型（accounts, chats, routes, messages, uploads, assets, events）
  accounts.rs       账户 CRUD、配置热重载
  chats.rs          聊天/成员 CRUD
  routes.rs         路由/会话绑定 CRUD
  resources.rs      上传/下载/消息/资源管理
  events.rs         路由事件列表
src/tests.rs        集成测试（#[cfg(test)] mod tests;）
src/bin/            独立二进制
  fake_client.rs    模拟客户端
  feishu_smoke.rs   飞书 smoke 测试
web/                浏览器前端资源
  index.html
  styles.css
  src/              前端 JS 模块
config.example.json 配置示例（仅占位符，无真实凭据）
```

## MCP API 通道

### control 通道 (`/api/v2/mcp/im_gateway_control`)

| Tool | 说明 | 需要 ExecutorSessionID |
|------|------|----------------------|
| GetGatewayInfo | 网关状态概览 | 否 |
| ReloadConfig | 配置热重载 | 是 |
| ListProviders | 列出 IM provider | 否 |
| ListAccounts | 列出账户 | 否 |
| UpsertAccount | 创建/更新账户 | 是 |
| DeleteAccount | 删除账户 | 是 |
| ListAccountChats | 列出账户聊天 | 否 |
| CreateAccountChat | 创建聊天 | 是 |
| DeleteAccountChat | 删除聊天 | 是 |
| ListAccountChatMembers | 列出聊天成员 | 否 |
| AddAccountChatMembers | 添加成员 | 是 |
| ListSessionBindings | 列出会话绑定 | 否 |
| UpsertSessionBinding | 更新会话绑定 | 是 |
| CreateSessionBinding | 创建会话绑定 | 是 |
| DeleteSessionBinding | 删除会话绑定 | 是 |
| ListRoutes | 列出路由 | 否 |
| GetRoute | 获取路由 | 否 |
| UpsertRoute | 更新路由 | 是 |
| DeleteRoute | 删除路由 | 是 |

### chat 通道 (`/api/v2/mcp/im_gateway_chat`)

| Tool | 说明 | 需要 ExecutorSessionID |
|------|------|----------------------|
| GetTransferEndpoint | 获取上传/资源 URL | 否 |
| ListRouteMessages | 列出路由消息 | 是 |
| SendRouteTextMessage | 发送文本消息 | 是 |
| RequestUpload | 请求上传槽 | 是 |
| SendRouteUpload | 发送已上传文件 | 是 |
| RequestDownload | 请求下载资源 | 是 |
| ListRecentRouteEvents | 列出路由事件 | 是 |

## 启动命令

```bash
cargo run -p im-endpoint -- --http 127.0.0.1:4092 --router-url ws://127.0.0.1:7200 --config endpoints/im/config.local.json
```

## 验证命令

```bash
cargo check -p im-endpoint --bins
cargo test -p im-endpoint --tests
```

## 代码规范

- 遵循 `GlassVein/AGENTS.md` 中的代码规范。
- 单文件不超过 500 行（含测试）；超过时拆分为独立模块。
- 测试代码放入 `tests.rs` 子模块（`#[cfg(test)] mod tests;`）。
- 凭据值（appId, appSecret, verificationToken, encryptKey）不得出现在日志、测试输出、README 或报告中。

## 安全规则

- Feishu/Lark 凭据仅从配置文件读取，不从环境变量读取。
- 提交的 `config.example.json` 仅含占位符。
- 真实配置文件必须位于 git ignored 的本地路径。
- Logs、测试输出、README 和报告中不得包含真实凭据值。

## 通信记录

| 角色 | Session ID | 说明 |
|------|-----------|------|
| GVS-IM | `ses_197cc2231ffeHFo04D6yKoXmag` | 监工，负责验收/文档/汇报 |
| GVW-IM | `ses_197cb17e9ffecWFYZejjjYfgGP` | 工人，负责代码实现 |
| GVMM | `ses_197d4b582ffed8eMvRJj2WUXQV` | 项目经理 |

## 变更记录

- 2026-05-27: GVS-IM 创建初始 AGENTS.md，建立端点记忆。
