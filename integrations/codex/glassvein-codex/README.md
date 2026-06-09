# GlassVein Codex Plugin

Codex-side GlassVein bridge. It lives beside the opencode integration and provides the first hook-based Codex runtime adapter.

## What It Does

- Captures Codex `UserPromptSubmit` and `Stop` lifecycle state into plugin data as JSONL.
- Injects bounded GlassVein metadata through `UserPromptSubmit.additionalContext`.
- Optionally publishes `session_update` upload envelopes to a local GlassVein router.
- Provides a reusable MCP hub script that can back separate Codex MCP servers such as `refs` and `timer` while injecting Codex session ownership fields.
- Can receive GV `control/add_prompt` envelopes from the router and start a new turn on an existing Codex app-server thread, equivalent to a fresh user message in that session.
- Adds a `glassvein` skill with the stable repo rules for GV work.

## Layout

```text
integrations/codex/glassvein-codex/
  .codex-plugin/plugin.json
  .mcp.json
  hooks/hooks.json
  hooks/user-prompt-submit.mjs
  hooks/stop.mjs
  gv-mcp.registry.example.json
  scripts/gv-mcp-hub.mjs
  scripts/gv-mcp-registry.mjs
  scripts/gv-codex-state-store.mjs
  scripts/gv-session-context.mjs
  scripts/gv-codex-app-server-bridge.mjs
  scripts/gv-codex-hook-lib.mjs
  skills/glassvein/SKILL.md
```

## Configuration

The plugin works without a running router. By default it records local hook state when Codex provides `PLUGIN_DATA`, injects concise session metadata, and does not attempt WebSocket upload.

Environment variables:

- `GV_CODEX_CAPTURE=0` disables local JSONL capture.
- `GV_CODEX_STATE_DIR=/path/to/state` overrides the capture directory.
- `GV_CODEX_CAPTURE_PROMPT=none|preview|full` controls prompt capture; default is `preview`.
- `GV_CODEX_CAPTURE_ASSISTANT=none|preview|full` controls assistant stop-message capture; default is `preview`.
- `GV_CODEX_INJECT=0` disables `additionalContext` injection.
- `GV_CODEX_CONTEXT_FILE=/path/a.md:/path/b.md` injects extra local context files.
- `GV_CODEX_CONTEXT_INLINE="..."` injects inline context for tests or local experiments.
- `GV_CODEX_SEND_ROUTER=1` enables router upload.
- `GV_CODEX_ROUTER_URL=ws://127.0.0.1:7240` overrides the router URL.
- `GV_CODEX_DOMAIN`, `GV_CODEX_RUNTIME`, `GV_CODEX_SESSION`, and `GV_CODEX_NODE_ID` override the OSGP address.
- `GV_CODEX_BINDINGS=0` disables Codex state SQLite session binding.
- `GV_CODEX_STATE_DB=/path/to/state_5.sqlite` overrides the Codex state SQLite database used for GV-owned binding data.
- `GV_MCP_REGISTRY_FILE=/path/to/gv-mcp.registry.json` loads a shared backend MCP server list for one hub process.
- `GV_MCP_SERVER_NAME=<server-name>` filters the shared MCP registry to one backend, so Codex can show separate MCP servers such as `refs` and `timer` while both use the same hub script.
- `GV_CODEX_APP_SERVER_URL=ws://127.0.0.1:4510` enables GV `control/add_prompt` delivery as Codex app-server `turn/start` on an existing thread.
- `GV_CODEX_THREAD_ID=<thread-id>` explicitly binds the adapter to an existing Codex app-server thread.
- `GV_CODEX_THREAD_MAP_FILE=/path/to/app-server-threads.json` points to a JSON map from Codex `sessionID` to existing app-server `threadId`.
- `GV_CODEX_RECEIVE_ROUTER=0` disables the adapter's GV router receive loop.

Default workspace context files are read if present:

```text
.glassvein/codex-context.md
.gv/codex-context.md
.codex/gv-context.md
```

## Wire Behavior

When `GV_CODEX_SEND_ROUTER=1`, each hook opens a short-lived WebSocket connection, sends the `osgp/1` handshake, announces its Codex session address, and uploads a canonical `session_update` envelope.

`UserPromptSubmit` sends:

```json
{ "sessionID": "<codex-session>", "state": "busy", "metadata": { "reason": "pending" } }
```

`Stop` sends:

```json
{ "sessionID": "<codex-session>", "state": "idle", "metadata": { "reason": "completed" } }
```

Prompt text is not included in injected context. Local capture stores a preview and SHA-256 hash by default; set full capture only for trusted local debugging.

## Codex State Binding

The plugin stores GV ownership binding inside Codex's SQLite state database, but only in GV-owned tables. Hook payload is the primary source: `UserPromptSubmit` and `Stop` record `input.thread_id || input.session_id` as the Codex thread binding and write `gv_session_bindings`. The MCP hub can also read Codex's `threads` table to resolve a bound thread, and if Codex does not pass a thread id to an MCP subprocess, the hub infers the likely thread from the parent Codex process and the `threads` table. It does not update Codex-owned tables such as `threads`, `thread_dynamic_tools`, or `thread_goals`.

The database path is resolved from `sqlite_home` in Codex config, then `CODEX_SQLITE_HOME`, then `CODEX_HOME`, and finally `~/.codex`. The latest `state_*.sqlite` file is used. Set `GV_CODEX_STATE_DB` to force an exact database path for tests or local debugging.

## GV MCP Hub

The hub has no backend tools by default. Add tools with one JSON registry that lists backend MCP servers.

One registry can contain multiple backends:

```json
{
  "servers": {
    "refs": {
      "type": "stdio-jsonrpc",
      "command": "/path/to/rec_mcp_memory_server",
      "inject": ["ExecutorSessionID"],
      "exposePrefix": false
    },
    "timer": {
      "type": "http-jsonrpc",
      "url": "http://127.0.0.1:8789/mcp/timer_scheduler",
      "runtimeQueryParam": "runtimeID",
      "inject": ["ExecutorRuntimeID", "ExecutorSessionID"],
      "exposePrefix": false,
      "tools": {
        "set_timer": {
          "target": "CreateOneShotTimer",
          "description": "Set a one-shot timer for this Codex session.",
          "inputSchema": {
            "type": "object",
            "properties": {
              "msg": { "type": "string" },
              "afterSeconds": { "type": "integer" },
              "title": { "type": "string" }
            },
            "required": ["msg", "afterSeconds"],
            "additionalProperties": false
          }
        }
      }
    }
  }
}
```

To keep Codex tools separated, register one Codex MCP entry per backend and point each entry at the same hub script and same registry file, with a different `GV_MCP_SERVER_NAME`.

```toml
[mcp_servers.refs]
command = "node"
args = ["/path/to/glassvein-codex/scripts/gv-mcp-hub.mjs"]

[mcp_servers.refs.env]
GV_MCP_REGISTRY_FILE = "/path/to/gv-mcp.registry.json"
GV_MCP_SERVER_NAME = "refs"

[mcp_servers.timer]
command = "node"
args = ["/path/to/glassvein-codex/scripts/gv-mcp-hub.mjs"]

[mcp_servers.timer.env]
GV_MCP_REGISTRY_FILE = "/path/to/gv-mcp.registry.json"
GV_MCP_SERVER_NAME = "timer"
```

In dedicated mode, `exposePrefix: false` exposes backend tools directly under that Codex MCP server, for example `read` under `refs` and `set_timer` under `timer`. Without `GV_MCP_SERVER_NAME`, the hub exposes the whole registry as an aggregate MCP and prefixes tools as `<server>.<tool>` to avoid collisions.

Adding a new MCP backend only needs two changes: add one entry under `servers` in the shared registry, then add one Codex MCP entry with `GV_MCP_SERVER_NAME` set to that entry name. The hub code does not need to change.

Start the local app-server and configure the plugin with its WebSocket URL when you want GV `control/add_prompt` delivery:

```bash
codex app-server --listen ws://127.0.0.1:4510
```

The hub does not create a new thread on delivery. Missing or stale session-to-thread binding is treated as an error.

The GV router must grant `announce.route` to both the Timer endpoint peer and the Codex adapter peer, otherwise the router will reject route announcements and Timer delivery will be dropped.
