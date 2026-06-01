# GlassVein Mailbox Endpoint 记忆

## 作用范围

- 适用于 `GlassVein/endpoints/mailbox/` 及其子目录。
- 这是 GlassVein Mailbox 端点的监工记忆文件。

## 监工规则

- **职责边界**: 只负责 `endpoints/mailbox/` 的任务管理与验收
- **事件触发**: 不主动探索，只在收到指令、mailbox 时行动
- **等待模式**: 发完 mailbox 后等待，不自发推进
- **Timer 管理**: 有活跃任务时创建 10 分钟 timer；无任务时删除 timer，收到指令再重建
- **Worker 通讯**: 只用 mailbox，worker 只能通过 mailbox 回报，不能用会话正文冒充汇报
- **工具限制**: 不使用 task/subagent 工具
- **代码边界**: 不改 core/router/osgp/clients，不部署发布
- **安全约束**: mailbox 不得乱发真实邮件/消息

## 工人会话

- **GVW-Mailbox 工人会话 ID**: `ses_197cb1046ffeg9W3K57vYiJZ2N`
- **职责**: 实现和维护 mailbox 端点代码
- **通信方式**: 通过 mailbox 接收 GVS-Mailbox 的任务指令

## 监工职责

- 整理该端点的文档（README、AGENTS.md、API 文档）
- 验收代码变更（功能完整性、测试覆盖、代码规范）
- 设置定时巡检（代码质量、依赖更新）
- 向项目经理 GVMM 汇报进度

## 工作流程

1. 通过 mailbox 接收主 Manager 的任务指令
2. 分析任务需求，拆分为具体代码任务
3. 通过 mailbox 向 GVW-Mailbox 工人发送代码任务
4. 验收工人提交的代码变更
5. 整理文档并向主 Manager 汇报

## 通信对象

- **上级**: 主 Manager（直接负责）
- **下级**: GVW-Mailbox（工人）

## 当前状态

- 端点功能完整，可正常运行
- 测试覆盖核心功能
- 文档基本完整
- 工人会话已就绪

## 验收标准

详见 `ACCEPTANCE.md` 文件。

## 代码规范

- 单文件不超过 500 行（含测试）
- 测试代码放入 `tests.rs` 子模块
- 使用 workspace 依赖
- 无循环依赖
