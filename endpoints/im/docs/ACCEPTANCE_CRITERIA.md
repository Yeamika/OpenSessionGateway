# IM Endpoint 验收标准

> 由 GVS-IM 监工维护，用于验收 GVW-IM 工人的代码变更。

## 一、编译与构建

| 编号 | 标准 | 验证方式 |
|------|------|----------|
| B-1 | `cargo check -p im-endpoint --bins` 无 error | 命令行 |
| B-2 | `cargo check -p im-endpoint --bins` 无 warning（允许已知 deprecated 警告） | 命令行 |
| B-3 | `cargo test -p im-endpoint --tests` 全部通过 | 命令行 |

## 二、代码规范

| 编号 | 标准 | 说明 |
|------|------|------|
| C-1 | 单文件不超过 500 行（含测试） | 超过时需拆分为独立模块文件 |
| C-2 | 测试代码放入 `#[cfg(test)] mod tests;` 子模块 | 与实现分离 |
| C-3 | 公开函数有 `///` 文档注释 | 至少一句话描述用途 |
| C-4 | 错误处理使用 `anyhow::Result` + `?` 传播 | 不用 `unwrap()` 在非测试路径 |
| C-5 | 无 `unsafe` 代码 | 除非有明确理由并记录 |
| C-6 | 变量/函数命名符合 Rust 风格（snake_case） | 无 camelCase 混用 |
| C-7 | 依赖仅来自 workspace Cargo.toml | 不引入新的外部依赖未经审批 |

## 三、功能完整性

| 编号 | 标准 | 说明 |
|------|------|------|
| F-1 | 所有 MCP tool 有对应实现 | `call_tool()` match arm 不遗漏 |
| F-2 | 新增 tool 需在 `tool_names()` 中注册 | `api.rs` 中 control/chat 通道 |
| F-3 | 新增 mutating tool 需在 `requires_executor()` 中标记 | `state.rs` 和 `api.rs` 两处 |
| F-4 | 新增 tool 需有对应测试 | 覆盖正常路径和错误路径 |
| F-5 | 配置热重载对新增字段有处理 | `reload_config()` 兼容新旧配置 |

## 四、测试覆盖

| 编号 | 标准 | 说明 |
|------|------|------|
| T-1 | 每个 MCP tool 至少一个正常路径测试 | 验证返回值结构 |
| T-2 | 每个 mutating tool 有缺失 ExecutorSessionID 的错误测试 | 验证错误消息 |
| T-3 | CRUD 操作有完整的增删查测试 | 見 `account_crud`, `chat_crud` 等 |
| T-4 | 配置热重载有更新/禁用/移除的测试 | 見 `config_reload_multi_account_update_disable` |
| T-5 | 新增 provider 类型有 mock 边界测试 | 見 `feishu_mock_and_real_boundary` |
| T-6 | 测试使用 `GvClient::test()` mock，不连接真实 router | 隔离测试 |

## 五、安全与凭据

| 编号 | 标准 | 说明 |
|------|------|------|
| S-1 | 凭据值不出现在代码、日志或测试输出中 | appId/appSecret/verificationToken/encryptKey |
| S-2 | `config.example.json` 仅含占位符 | 不含真实凭据 |
| S-3 | `mask_account()` 正确掩码敏感字段 | 凭据不出现在 `ListAccounts` 返回中 |
| S-4 | Feishu 非 mock 模式只能通过配置文件加载 | `ensure_feishu_mockable()` 正确拦截 |

## 六、OSGP 协议一致性

| 编号 | 标准 | 说明 |
|------|------|------|
| P-1 | GV 客户端发送正确的 OSGP envelope | link_type = "control" 或 "request" |
| P-2 | subtype 格式为 `im_gateway.{channel}.{tool}` | 見 `gv.rs` send_tool |
| P-3 | source/target 地址使用配置的 SessionAddress | 不硬编码 |
| P-4 | hello 消息包含 `role: "endpoint"` 和 `capabilities: ["im_endpoint"]` | 見 `gv.rs` |

## 七、Web 前端

| 编号 | 标准 | 说明 |
|------|------|------|
| W-1 | 新增 API 路由在 `api.rs` 的 `route()` 中注册 | HTTP 路由正确分发 |
| W-2 | 静态资源通过 `include_bytes!` 内嵌 | 无外部文件依赖 |
| W-3 | CORS 头 `access-control-allow-origin: *` 正确设置 | 見 `write_response()` |

## 八、文档

| 编号 | 标准 | 说明 |
|------|------|------|
| D-1 | 新增 tool 在 `AGENTS.md` MCP API 表格中记录 | 包含说明和 ExecutorSessionID 要求 |
| D-2 | README.md 中的 Layout 部分反映新增文件 | 目录结构文档同步 |
| D-3 | config.example.json 包含新增配置字段的占位符 | 配置文档同步 |

## 验收流程

1. **GVW-IM** 通过 mailbox 向 GVS-IM 提交变更说明
2. **GVS-IM** 检查代码变更是否满足上述标准
3. 如有不满足项，通过 mailbox 列出问题并要求修复
4. 全部满足后，GVS-IM 标记任务完成并向 GVMM 汇报

## 变更记录

- 2026-05-27: GVS-IM 创建初始验收标准文档。
