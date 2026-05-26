# GlassVein Mailbox Endpoint

Standalone mailbox endpoint for HTTP API, MCP, and a minimal status web page.

- MCP path: `POST /api/v2/mcp/mailbox`
- HTTP status: `GET /api/status`
- Hot reload: `POST /api/config/reload` or MCP `ReloadConfig`
- Config file: `--config endpoints/mailbox/config.local.json`; CLI `--listen` overrides file listen address.

Mailbox tools: `ListMailboxItems`, `ReadMailboxItem`, `SendMailboxItem`, `ReplyMailboxItem`, `DeleteMailboxItem`, `MailboxReminders`.

`ExecutorSessionID` selects the caller mailbox bucket. Optional `ExecutorRuntimeID` scopes caller runtime. `runtimeID` and `sessionID` on send are target identifiers only.
