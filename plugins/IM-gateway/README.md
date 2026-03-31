# IM Gateway Plugin

Multi-route IM gateway plugin for OSG.

## Structure

```text
IM-gateway/
  index.ts
  src/
  plugins/
    feishu/
    koishi-lark/
```

## Current Provider Plugins

- `plugins/feishu/`
- `plugins/koishi-lark/`

## What the Core Owns

- local HTTP port,
- upload endpoints that return internal `uploadID`,
- local resource download endpoints so MCP clients do not need provider auth,
- cached chat/message state,
- MCP tools for chat listing, OSG binding, and message sending,
- `uploadID -> provider resourceKey` indirection so MCP clients do not see provider keys,
- inbound IM to OSG prompt forwarding for a dedicated session binding.

## Recommended Image Flow

1. Call `GetUploadEndpoint`
2. POST raw image bytes to `imageUploadURL`
3. Receive `uploadID`
4. Call `SendUploadedImage(chatID, uploadID)` via MCP

## Recommended File Flow

1. Call `GetUploadEndpoint`
2. POST raw file bytes to `fileUploadURL`
3. Receive `uploadID`
4. Call `SendUploadedFile(chatID, uploadID)` via MCP

## Image Read Flow

1. Call `ListChatMessages`
2. Read the returned local `downloadURL`
3. Download it directly or use `download_image.py <downloadURL>`

The same local `downloadURL` pattern also works for file resources.

## OSG Forwarding Flow

1. Bind a runtime/session with `CreateAndBindOsgSession` or `SetOsgBinding`
2. Let provider inbound traffic reach the bridge (`feishu` supports local webhook plus official Feishu websocket realtime events; `koishi-lark` currently relies on polling)
3. The gateway calls OSG `addPrompt` with the inbound text as `msg` and optional per-turn context in `system`
4. The target session can answer the user with IM Bridge MCP tools such as `SendTextMessage`, `SendUploadedImage`, and `SendUploadedFile`

## Feishu Realtime Notes

- `FEISHU_WS_ENABLED=true` enables the official Feishu long-connection client.
- `FEISHU_WS_AUTO_RECONNECT=true` keeps reconnect attempts on.
- OSG session `busy` / `idle` / `error` status notices use the server-side `onSessionStatusChange` hook when available.
- Direct Feishu currently marks `busy` by adding an `OK` reaction to the latest inbound user message, and removes that reaction on `idle` / `error`.
- Webhook handling stays available, and polling remains available as a separate fallback path for IM message sync and older server hosts.
- The Feishu app must be configured in the developer console to receive events through persistent connection mode.

## AddPrompt Migration Note

The OSG `addPrompt` API is now narrowed to session input:

- `msg` is always the user message,
- `system` is optional per-turn system context,
- role-based usage like `role: "system"` or `role: "tool"` is deprecated.

If a bridge integration needs extra context for one forwarded turn, pass it through `system` instead of trying to inject a non-user role.

## Current MCP Tools

- `GetUploadEndpoint`
- `GetBridgeInfo`
- `GetOsgBinding`
- `SetOsgBinding`
- `CreateAndBindOsgSession`
- `ListChats`
- `GetChat`
- `ListChatMessages`
- `SendTextMessage`
- `SendUploadedImage`
- `SendUploadedFile`
- `ListRecentEvents`

## Current Default

- provider: `feishu`
- alternate provider: `koishi-lark`
- upload address example: `127.0.0.1:4090`
- image upload path example: `http://127.0.0.1:4090/imgw/uploads/images`
- file upload path example: `http://127.0.0.1:4090/imgw/uploads/files`
- image download path example: `http://127.0.0.1:4090/imgw/downloads/image/<messageID>/<resourceKey>`
- file download path example: `http://127.0.0.1:4090/imgw/downloads/file/<messageID>/<resourceKey>`

## Helper Scripts

- `upload_image.py <file> [port] [host]`
- `upload_file.py <file> [port] [host]`
- `download_image.py <downloadURL> [dir]`
