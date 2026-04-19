# session-bridge

## 1.定位

- 提供跨 session 的桥接能力。
- 以 mailbox 作为主要消息模型。

## 2.当前主链路

- `SendMailboxItem`
- `ListMailboxItems`
- `ReadMailboxItem`
- `ReplyMailboxItem`
- `GetSessionMessages`
- `ListLivingSessions`

## 3.边界

- 不接管 session 本身。
- 只负责跨 session 消息投递、读取、回复与提醒。
