# GlassVein Codex Plugin

Codex-side GlassVein bridge. It lives beside the opencode integration and provides the first hook-based Codex runtime adapter.

## What It Does

- Captures Codex `UserPromptSubmit`, `PreToolUse`, and `Stop` lifecycle state into plugin data as JSONL or direct MCP call context.
- Injects bounded GlassVein metadata through `UserPromptSubmit.additionalContext`.
- Optionally publishes `session_update` upload envelopes to a local GlassVein router.
- Provides a reusable MCP hub script that can back separate Codex MCP servers such as `refs` and `timer` while injecting Codex session ownership fields.
- Can receive GV `control/add_prompt` envelopes from the router and start a Codex app-server turn on an existing, resumed, forked, or newly created app-server conversation thread.
- Registers GV MCP backends as app-server dynamic tools for GV-started threads, so refs/timer calls can be routed through GV with thread ownership attached by the app-server client.
- Adds a `glassvein` skill with the stable repo rules for GV work.

## Layout

```text
integrations/codex/glassvein-codex/
  .codex-plugin/plugin.json
  .mcp.json
  hooks/hooks.json
  hooks/pre-tool-use.mjs
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
- `GV_CODEX_APP_THREAD_MODE=existing|auto|start|resume|fork` selects how GV delivery binds to Codex app-server threads. The default is `existing`, which does not create threads.
- `GV_CODEX_APP_DYNAMIC_TOOLS=0` disables exposing GV MCP registry entries as app-server dynamic tools.
- `GV_CODEX_DYNAMIC_MCP_SERVERS=refs,timer` limits which registry entries are exposed as app-server dynamic tools. Omit it to expose all GV registry entries.
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

The plugin stores GV ownership binding inside Codex's SQLite state database, but only in GV-owned tables. Command hook payload is the primary source: `UserPromptSubmit` and `Stop` record `input.thread_id || input.session_id` as the Codex binding and write `gv_session_bindings`.

For MCP tool calls, the reliable path is the `PreToolUse` hook. Codex command hooks expose `session_id`, `turn_id`, `tool_use_id`, and, for subagents, `agent_id`. The GV `PreToolUse` hook attaches those values to GV MCP arguments as `__gvCodexContext`; the hub removes that private field before forwarding to the backend and uses it to inject fields such as `ExecutorSessionID`, `ExecutorThreadID`, `ExecutorTurnID`, and `ExecutorToolUseID`. The hook only updates MCP tools whose Codex MCP server config points at `gv-mcp-hub.mjs`, so unrelated MCP servers are left unchanged.

Multiple Codex threads can share one GV hub process. Ownership is carried per tool call, so thread A and thread B remain isolated even when they call the same backend MCP server. Subagent calls use `agent_id` as `ExecutorThreadID` and keep the root Codex session in `ExecutorRootSessionID`.

The hub does not infer the current caller by scanning Codex's `threads` table, by reading GV binding rows, or by using session environment variables. Without direct hook context, MCP ownership is treated as missing. The plugin does not update Codex-owned tables such as `threads`, `thread_dynamic_tools`, or `thread_goals`.

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

By default, delivery does not create a new app-server thread: missing or stale session-to-thread binding is treated as an error. To use real independent Codex conversation threads, set `GV_CODEX_APP_THREAD_MODE=auto` so each GV session starts its own `thread/start` thread and later resumes the mapped thread before `turn/start`. A GV `control/add_prompt` payload can also override this per message with `threadMode: "start"`, `"resume"`, or `"fork"` plus `threadId` or `sourceThreadId` when needed.

For GV-started app-server threads, the bridge registers each GV registry entry as Codex dynamic tools using `namespace=<server name>` and `name=<tool name>`, for example `refs.rg`. Dynamic tool calls return to the GV app-server client as `item/tool/call`; the client uses the app-server `threadId`, `turnId`, and `callId` to inject `ExecutorSessionID`, `ExecutorThreadID`, `ExecutorTurnID`, and `ExecutorToolUseID` before forwarding to the backend MCP server. This avoids relying on hidden model-visible MCP arguments, environment variables, or Codex database guessing.

The GV router must grant `announce.route` to both the Timer endpoint peer and the Codex adapter peer, otherwise the router will reject route announcements and Timer delivery will be dropped.
