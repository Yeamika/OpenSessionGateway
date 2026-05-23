# IM Endpoint

`endpoints/im/` is the GlassVein IM endpoint project. The endpoint owns its API server, GlassVein WebSocket connection, config-driven IM account runtimes, and web frontend assets.

## Role boundary

- **Endpoint role:** connects to a GlassVein router as OSGP `role: "endpoint"` with an IM endpoint address.
- **Server/API:** exposes MCP-compatible JSON-RPC `tools/call` paths for IM accounts, chats, members, session bindings, routes, route messages, and upload placeholders.
- **Web frontend:** served by this endpoint at `/`, using the same API paths as the server.
- **GV adapter:** builds/consumes canonical OSGP `request`, `control`, and `response` envelopes.
- **Not owned here:** core routing decisions, router internals, OSGP protocol definitions, and Rust client SDK code.

## Layout

```text
src/config.rs       CLI config, including --config path
src/im_config.rs    JSON config schema, secret masking, account templates
src/feishu.rs       config-driven Feishu/Lark token/smoke adapter
src/state/          account/chat/route/resource/event state modules
src/api.rs          HTTP/MCP-compatible API and static web serving
web/                browser frontend assets
```

## Start

```bash
cargo run -p im-endpoint -- --http 127.0.0.1:4092 --router-url ws://127.0.0.1:7200 --config endpoints/im/config.local.json
```

Use `--no-config` to start with no accounts. `endpoints/im/config.local.json` is ignored by git. Copy `config.example.json` to a local/private path and replace placeholders there only.

## Config hot reload

- MCP tool: `ReloadConfig`
- HTTP API: `POST /api/config/reload`

Reload reads the configured JSON file, enables new/updated accounts, disables removed/disabled accounts, and keeps routes/session bindings compatible where possible. `ListAccounts` reflects the active runtime state after reload.

## Web entry

Open `http://127.0.0.1:4092/`. The page manages accounts, chats, session bindings, routes, route messages, sending text, and upload placeholders via:

- `/api/v2/mcp/im_gateway_control`
- `/api/v2/mcp/im_gateway_chat`

## Feishu/Lark credentials

Feishu/Lark credentials are read from the config file only, not from environment variables. The committed `config.example.json` contains field names and placeholders only. Real config files must stay in ignored/local paths. Logs, test output, README, and mailbox reports must never include app secrets, encrypt keys, verification tokens, tenant tokens, or real credential values.

Real smoke uses `src/bin/feishu_smoke.rs --config <path> [--account <accountID>] [--send]`. Token verification is read-only. Sending a message requires account `test.chatID` plus `test.allowSendSmoke: true`; otherwise it reports blocked/skipped.

## ExecutorSessionID audit

Mutating operations and route-message/resource event reads require `ExecutorSessionID` in MCP tool arguments. `ExecutorRuntimeID` is optional. These fields identify the caller/executor session for audit ownership and are distinct from target `sessionID` and `sessionBindingID`.

## Manual validation

1. `cargo check -p im-endpoint --bins`
2. `cargo test -p im-endpoint --tests`
3. `cargo run -p im-endpoint -- --http 127.0.0.1:4092 --config .tmp/im-config.json`
4. `curl -X POST http://127.0.0.1:4092/api/config/reload`
