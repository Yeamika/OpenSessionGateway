# Session Control Endpoint 验收标准

## 概述

本文档定义 `session-control-endpoint` 的代码变更验收标准。所有代码变更必须满足以下条件才能通过验收。

## 1. 功能完整性

### 1.1 核心功能

- [ ] GV WebSocket 连接管理（connect/disconnect）
- [ ] Session 状态更新处理
- [ ] Request/Control envelope 发送
- [ ] MCP JSON-RPC 支持
- [ ] HTTP API 端点实现
- [ ] Web UI 可用

### 1.2 MCP 工具

- [ ] `state` - 返回当前状态快照
- [ ] `connect` - 连接到 GV router
- [ ] `disconnect` - 断开连接
- [ ] `request` - 发送 request envelope
- [ ] `control` - 发送 control envelope
- [ ] `ReloadConfig` - 热重载配置
- [ ] `ListLivingSessions` - 列出活跃会话
- [ ] `GetSessionMessages` - 获取会话消息

## 2. 测试覆盖

### 2.1 单元测试

- [ ] 所有公开函数有对应测试
- [ ] 边界条件测试覆盖
- [ ] 错误路径测试覆盖
- [ ] 异步函数测试使用 `#[tokio::test]`

### 2.2 集成测试

- [ ] MCP 工具调用测试
- [ ] 状态管理测试
- [ ] 配置加载/重载测试
- [ ] Web API 端点测试

### 2.3 测试运行

```bash
# 运行所有测试
cargo test -p session-control-endpoint

# 运行特定测试
cargo test -p session-control-endpoint -- --test-threads=1
```

## 3. 代码规范

### 3.1 文件结构

- [ ] 单文件不超过 500 行（含测试）
- [ ] 测试代码放入 `tests.rs` 子模块
- [ ] 模块职责清晰分离

### 3.2 Rust 规范

- [ ] 使用 `anyhow::Result` 进行错误处理
- [ ] 使用 `tokio` 异步运行时
- [ ] 遵循 Rust 命名规范（snake_case, CamelCase）
- [ ] 无 `unwrap()` 在生产代码中（测试除外）
- [ ] 适当的错误传播（`?` 操作符）

### 3.3 依赖管理

- [ ] 使用 workspace 依赖（`workspace = true`）
- [ ] 不引入不必要的依赖
- [ ] 依赖版本与 workspace 一致

## 4. 文档

### 4.1 代码文档

- [ ] 公开函数有 `///` 文档注释
- [ ] 复杂逻辑有行内注释
- [ ] 模块有 `//!` 文档注释

### 4.2 README

- [ ] 功能说明清晰
- [ ] 运行命令正确
- [ ] 配置示例可用

## 5. 安全性

### 5.1 输入验证

- [ ] 所有外部输入验证
- [ ] JSON 解析错误处理
- [ ] 地址格式验证

### 5.2 错误处理

- [ ] 错误信息不泄露敏感信息
- [ ] 错误传播链完整
- [ ] 日志记录关键错误

## 6. 性能

### 6.1 资源管理

- [ ] 无内存泄漏（Arc/Mutex 正确使用）
- [ ] 异步任务正确取消
- [ ] 连接断开时资源清理

### 6.2 并发

- [ ] 共享状态使用 `Arc<Mutex<>>`
- [ ] 无死锁风险
- [ ] 异步操作无阻塞

## 7. 验收流程

### 7.1 提交前检查

```bash
# 1. 编译检查
cargo build -p session-control-endpoint

# 2. 测试运行
cargo test -p session-control-endpoint

# 3. 代码格式
cargo fmt -p session-control-endpoint -- --check

# 4. Clippy 检查
cargo clippy -p session-control-endpoint -- -D warnings
```

### 7.2 验收清单

- [ ] 所有测试通过
- [ ] 无编译警告
- [ ] 无 Clippy 警告
- [ ] 代码格式正确
- [ ] 文档更新（如需要）
- [ ] AGENTS.md 更新（如需要）

## 8. 版本控制

### 8.1 提交规范

- [ ] 提交信息清晰描述变更
- [ ] 单一功能/修复 per commit
- [ ] 关联 issue（如有）

### 8.2 分支管理

- [ ] 从最新 main 分支创建特性分支
- [ ] 变更通过 PR 合并
- [ ] 无冲突

## 9. 已知问题

### 9.1 当前限制

- 无连接重试机制
- 无会话状态持久化
- Web UI 功能有限

### 9.2 后续改进

- [ ] 添加连接重试机制
- [ ] 实现会话状态持久化
- [ ] 扩展 MCP 工具集
- [ ] 改进错误处理
- [ ] 增强 Web UI 功能
