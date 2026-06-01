# Requestion Endpoint 记忆

## 作用范围

- 适用于 `GlassVein/endpoints/requestion/` 及其子目录。
- 是 GlassVein 的 requestion cache/snapshot 端点，角色为 `endpoint` + `surface_viewer` capability。

## 目录结构

```text
Cargo.toml              — Rust crate 配置
README.md               — 端点说明文档
acceptance-criteria.md  — GVS-Requestion 验收标准
config.example.json     — 配置示例
src/
  main.rs               — 进程入口：CLI、GV WebSocket 连接、cache 共享、任务启动
  handler.rs            — 入站 envelope/ReadRequest 处理和 cache 变更
  handler_tests.rs      — handler 测试
  cache.rs              — 内存 requestion/session state 模型
  gv_client.rs          — 出站 requestion_respond control 信封构建
  cli.rs                — CLI 配置和参数解析
  web.rs                — 最小 HTTP server，提供 web UI、JSON API、MCP-style tool API
  web_tests.rs          — web 测试
  seed.rs               — demo 数据填充
web/
  index.html            — 浏览器 UI
  app.js                — 前端逻辑
  styles.css            — 样式
```

## 架构要点

- 连接 GV router 为 generic endpoint，Hello 时带 `capabilities: ["surface_viewer"]`
- 收集 upload 子类型：`requestion_asked`、`requestion_updated`、`requestion_resolved`、`requestion_cancelled`、`session_update`
- 兼容旧 dotted 格式（`requestion.asked` 等）通过 `eventSubtype` payload 字段
- OSGP 统一 requestion 模型：`permission.asked` 和 `question.asked` 也作为 requestion item 处理
- 出站操作使用 canonical control 信封，subtype `requestion_respond`
- router 保持无状态；端点进程内维护 cache
- 不修改 core、router、osgp 或 Rust clients

## 构建与测试

```bash
# 构建
cargo build -p requestion-endpoint

# 测试
cargo test -p requestion-endpoint

# Clippy
cargo clippy -p requestion-endpoint

# 运行（需要 router URL）
cargo run -p requestion-endpoint -- --config endpoints/requestion/config.example.json
```

## 代码规范

- 单文件不超过 500 行（含测试），超过时拆分
- 测试使用 `#[cfg(test)] #[path = "xxx_tests.rs"] mod xxx_tests;` 模式
- 不在本端点中引入 workspace crate 循环依赖
- 不引入旧协议概念（`ObserverSurface`/`ControlSurface` 作为 role、`kind` 字段等）

## HTTP / MCP API 端点

| 路径 | 方法 | 说明 |
|------|------|------|
| `/` | GET | Web UI |
| `/api/config` | GET | 运行时配置 |
| `/api/config/reload` | POST | 热重载配置 |
| `/api/requestions` | GET | pending cache snapshot |
| `/api/respond` | POST | 审批/拒绝/回复 |
| `/mcp` | POST | MCP-style JSON-RPC (tools/list, tools/call) |

## 监工信息

- 监工：GVS-Requestion
- 工人：GVW-Requestion (Worker-MIMO)
- GVW sessionID: `ses_197c97e6effe9QbP7LiX31Mu83`
