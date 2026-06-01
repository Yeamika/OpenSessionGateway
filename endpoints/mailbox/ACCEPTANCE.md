# GlassVein Mailbox Endpoint 验收标准

## 概述

本文档定义了 GlassVein Mailbox 端点的验收标准，用于指导代码审查和功能验证。

## 功能完整性

### 核心功能

- [ ] **ListMailboxItems**: 列出指定会话的邮箱项目
  - 支持 `ExecutorSessionID` 和 `ExecutorRuntimeID` 过滤
  - 支持 `size` 参数限制返回数量
  - 支持 `regex` 和 `metadataRegex` 过滤
  - 按时间倒序排列

- [ ] **ReadMailboxItem**: 读取指定邮箱项目
  - 支持 `itemID` 参数
  - 自动标记为已读
  - 返回完整项目信息

- [ ] **SendMailboxItem**: 发送邮箱项目
  - 支持 `Notice` 和 `NeedReplay` 类型
  - 自动生成 `itemID` 和 `replayID`（如需要）
  - 正确设置发送者和接收者信息

- [ ] **ReplyMailboxItem**: 回复邮箱项目
  - 支持 `replayID` 参数
  - 自动生成回复项目
  - 更新原项目状态为 `Replaied`

- [ ] **DeleteMailboxItem**: 删除邮箱项目
  - 支持 `itemID` 参数
  - 验证权限（只能删除自己的项目）

- [ ] **MailboxReminders**: 获取提醒列表
  - 只返回未读的 `NeedReplay` 类型项目
  - 按时间倒序排列

### MCP 集成

- [ ] 支持 `tools/list` 方法
- [ ] 支持 `tools/call` 方法
- [ ] 支持 `status` 工具
- [ ] 支持 `ReloadConfig` 工具
- [ ] 正确的 JSON-RPC 2.0 响应格式

### HTTP API

- [ ] `GET /api/status`: 返回状态信息
- [ ] `GET /api/config`: 返回配置信息
- [ ] `POST /api/config/reload`: 重新加载配置
- [ ] `POST /api/mailbox/list`: 列出邮箱项目
- [ ] `POST /api/mailbox/read`: 读取邮箱项目
- [ ] `POST /api/mailbox/send`: 发送邮箱项目
- [ ] `POST /api/mailbox/reply`: 回复邮箱项目
- [ ] `POST /api/mailbox/delete`: 删除邮箱项目
- [ ] `POST /api/mailbox/reminders`: 获取提醒列表
- [ ] `POST /api/v2/mcp/mailbox`: MCP 端点

### Web UI

- [ ] 状态显示正常
- [ ] 发送邮件功能正常
- [ ] 列表显示正常
- [ ] 错误处理正常

## 测试覆盖

### 单元测试

- [ ] 邮箱 CRUD 操作测试
- [ ] 回复功能测试
- [ ] 删除功能测试
- [ ] 排序功能测试
- [ ] 权限隔离测试
- [ ] MCP 工具列表测试
- [ ] MCP 工具调用测试
- [ ] 配置重新加载测试

### 集成测试

- [ ] HTTP API 端点测试
- [ ] MCP 端点测试
- [ ] Web UI 功能测试

### 边界测试

- [ ] 空参数处理
- [ ] 无效参数处理
- [ ] 权限验证
- [ ] 并发访问测试

## 代码规范

### 代码质量

- [ ] 单文件不超过 500 行（含测试）
- [ ] 测试代码放入 `tests.rs` 子模块
- [ ] 清晰的模块结构
- [ ] 适当的错误处理
- [ ] 必要的注释和文档

### 依赖管理

- [ ] 使用 workspace 依赖
- [ ] 无循环依赖
- [ ] 最小化外部依赖

### 性能要求

- [ ] 响应时间 < 100ms（本地操作）
- [ ] 内存使用合理
- [ ] 无内存泄漏

## 安全要求

### 权限控制

- [ ] 只能访问自己的邮箱
- [ ] 只能删除自己的项目
- [ ] 正确的发送者/接收者隔离

### 输入验证

- [ ] 所有必填参数验证
- [ ] 参数格式验证
- [ ] 防止注入攻击

## 文档完整性

- [ ] README.md 更新
- [ ] API 文档完整
- [ ] 配置说明完整
- [ ] 使用示例完整

## 部署要求

### 配置管理

- [ ] 支持命令行参数
- [ ] 支持配置文件
- [ ] 支持热重载

### 监控和日志

- [ ] 状态端点正常
- [ ] 日志记录完整
- [ ] 错误追踪正常

## 验收流程

1. **代码审查**: 检查代码质量和规范
2. **功能测试**: 运行所有测试用例
3. **集成测试**: 验证端点功能
4. **性能测试**: 验证响应时间和资源使用
5. **安全测试**: 验证权限和输入验证
6. **文档审查**: 检查文档完整性

## 验收标准

- 所有核心功能正常工作
- 测试覆盖率达到 80% 以上
- 无严重 bug 或安全问题
- 文档完整且准确
- 性能符合要求
