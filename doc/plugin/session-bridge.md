# session-bridge

## 1.代码入口

- `plugins/session-bridge/index.ts`
- `plugins/session-bridge/surface.ts`
- `plugins/session-bridge/mailbox.ts`
- `plugins/session-bridge/tools/*.ts`

route segment：`session_bridge`

公开 endpoint：`/api/v2/mcp/session_bridge`

## 2.JSON-RPC 行为

代码：`plugins/session-bridge/surface.ts`

支持的方法：

- `initialize`
- `notifications/initialized`
- `tools/list`
- `tools/call`

说明：

- `initialize` 阶段要求 `runtimeID`。
- `tools/call` 阶段要求 query 中带 `runtimeID`。

## 3.工具集

- `ListLivingSessions`
- `GetSessionMessages`
- `ListMailboxItems`
- `ReplyMailboxItem`
- `SendMailboxItem`
- `ReadMailboxItem`

## 4.mailbox 模型

核心代码：`plugins/session-bridge/mailbox.ts`

主要字段：

- `recipientRuntimeID`
- `recipientSessionID`
- `senderRuntimeID`
- `senderSessionID`
- `senderSessionTitle`
- `mailType`
- `infoType`
- `title`
- `content`
- `replayID`
- `hasRead`

主要类型：

- `Notice`
- `NeedReplay`
- `QuestReply`
- `Replaied`

## 5.提醒链路

mailbox 除了消息存储，还会触发提醒：

- toast 提醒
- session reminder prompt

提醒内容由：

- `MAILBOX_REMINDER_USER_MSG`
- `createReminderPrompt()`

生成。

## 6.与客户端的边界

- `session-bridge` 不托管 session。
- 只负责跨 session 的消息桥接。
- Session 消息的真实存储和执行仍由客户端负责。
