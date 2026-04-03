# IM Gateway Plugin

Package-style IM gateway plugin for OSG.

## Runtime model

- manifest id: `im-gateway`
- package name: `@opensessiongateway/osg-plugin-im-gateway`
- package autoload: `false`
- default host: `127.0.0.1`
- default port: `4092`
- default route prefix: `imgw`

When loaded, the plugin starts its own local HTTP server and registers two MCP surfaces:

- `/api/v2/mcp/im_gateway_control`
- `/api/v2/mcp/im_gateway_chat`

## Current builtin provider

The current repo build registers one builtin provider:

- `plugins/feishu/`

Provider adapters are pluggable in code, but `koishi-lark` is not a current repo-shipped provider folder.

## What the gateway owns

- local HTTP transfer endpoints for uploads, assets, and webhooks
- provider account state
- route state
- OSG `sessionBindingID` state
- recent route messages and inbound events
- local upload and asset indirection so MCP callers do not need provider credentials
- inbound provider-to-OSG forwarding through `ctx.osg.addPrompt()`

## Control surface tools

- `GetGatewayInfo`
- `ListProviders`
- `ListAccounts`
- `UpsertAccount`
- `DeleteAccount`
- `ListAccountChats`
- `CreateAccountChat`
- `DeleteAccountChat`
- `ListAccountChatMembers`
- `AddAccountChatMembers`
- `ListSessionBindings`
- `UpsertSessionBinding`
- `CreateSessionBinding`
- `DeleteSessionBinding`
- `ListRoutes`
- `GetRoute`
- `UpsertRoute`
- `DeleteRoute`

## Chat surface tools

- `GetTransferEndpoint`
- `ListRouteMessages`
- `SendRouteTextMessage`
- `RequestUpload`
- `SendRouteUpload`
- `RequestDownload`
- `ListRecentRouteEvents`

## Transfer flow

### Upload

1. Call `RequestUpload`
2. POST bytes to the returned upload URL
3. Call `SendRouteUpload`

`GetTransferEndpoint` returns the shared patterns:

- `requestUploadURL`: `http://127.0.0.1:4092/imgw/uploads/{uploadID}`
- `assetURLPrefix`: `http://127.0.0.1:4092/imgw/assets/`

### Download

1. Call `ListRouteMessages`
2. Call `RequestDownload`
3. Fetch the returned `downloadURL`

`RequestDownload` creates one `assetID` and returns a local asset URL.

## OSG forwarding flow

1. Configure or create a `sessionBindingID`
2. Map one IM route to that binding
3. Let provider inbound traffic reach the gateway by websocket, webhook, or provider polling fallback
4. The gateway calls OSG `addPrompt` with the inbound user text in `msg` and route metadata in `system`
5. The target session replies through IM gateway chat tools such as `SendRouteTextMessage` or `SendRouteUpload`

## AddPrompt note

The OSG `addPrompt` API is now narrowed to session input:

- `msg` is always the user message
- `system` is optional per-turn system context
- role-based usage such as `role: "system"` or `role: "tool"` is deprecated

## Feishu notes

- Feishu websocket behavior is configured per account through `config.wsEnabled` and `config.wsAutoReconnect`
- webhook handling remains available
- provider polling remains available as a sync and fallback path
- OSG session `busy` / `idle` / `error` status notices use the server-side session-status hook when available
- direct Feishu currently marks `busy` by adding a `Typing` reaction to the latest inbound user message, then removes it on `idle` or `error`

## Helper scripts

- `upload_image.py <file> [port] [host]`
- `upload_file.py <file> [port] [host]`
- `download_image.py <downloadURL> [dir]`
