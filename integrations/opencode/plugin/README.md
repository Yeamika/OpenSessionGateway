# @opensessiongateway/opencode-vein-plugin

GlassVein opencode plugin — independent WS client for GlassVein router integration.

Location: `integrations/opencode/plugin/`

## Overview

This package provides an opencode **server plugin** for connecting opencode workspace instances to GlassVein. By default the plugin starts one server-level local GlassVein router and all workspace clients connect to that router.

## Architecture

- **One server-level internal Rust router process** by default.
- **One TS client per workspace** (keyed by `ctx.directory`) connects to the server-level router.
- **Wire protocol follows OSGP (OpenSessionGateway Protocol)**:
  - SessionEnvelope uses canonical `linkType/subtype` routing; legacy `kind` is present only for router compatibility.
  - `linkType` ∈ {`upload`, `control`, `request`, `response`}.
  - `subtype` carries the semantic event name (e.g., `session_update`, `requestion.asked`).
- **Client sends**: `LinkHandshake`, `announce`, then `linkType=upload` session_update and requestion_asked/resolved.
- **Client receives** (`linkType=control`): control commands → dispatches to existing manager/ctx via `subtype`.
- `control.command` / permission / question do NOT have independent main chains; all use `type/subtype`.
- Detailed opencode message content (message.updated, message.part.updated, etc.) is NOT sent as wire upload; retained for local state tracking only.

## Installation

```bash
npm install @opensessiongateway/opencode-vein-plugin
```

## Usage

### As an opencode plugin

```bash
opencode plug @opensessiongateway/opencode-vein-plugin --global
opencode serve
```

The package root and `./server` export point at the opencode server plugin entry.

By default the plugin starts an internal router at `127.0.0.1:7240` and connects to `ws://127.0.0.1:7240`.

### Server-level router configuration

Environment variables:

| Variable | Description |
|---|---|
| `GV_INTERNAL_ROUTER=false` | Disable the built-in router. Use with `GV_ROUTER_URL`. Aliases: `VEIN_INTERNAL_ROUTER`, `OSG_INTERNAL_ROUTER`. |
| `GV_ROUTER_PORT=7241` | Built-in router port. Aliases: `VEIN_ROUTER_PORT`, `OSG_ROUTER_PORT`. |
| `GV_ROUTER_BIND_HOST=127.0.0.1` | Built-in router bind host. Aliases: `VEIN_ROUTER_BIND_HOST`, `OSG_ROUTER_BIND_HOST`. |
| `GV_ROUTER_BIND_ADDR=127.0.0.1:7241` | Full bind address; overrides host/port pair. Aliases: `VEIN_ROUTER_BIND_ADDR`, `OSG_ROUTER_BIND_ADDR`. |
| `GV_UPSTREAM_ROUTER_URL=ws://127.0.0.1:4090` | Upstream router for the built-in router. Aliases: `VEIN_UPSTREAM_ROUTER_URL`, `OSG_UPSTREAM_ROUTER_URL`. |
| `GV_UPSTREAM_ROUTER_URLS=ws://a,ws://b` | Comma-separated upstream routers. Aliases: `VEIN_UPSTREAM_ROUTER_URLS`, `OSG_UPSTREAM_ROUTER_URLS`. |
| `GV_ROUTER_STATE_FILE=~/.config/opencode-vein-plugin/logs/internal-router-state.json` | Built-in router state file. Aliases: `VEIN_ROUTER_STATE_FILE`, `OSG_ROUTER_STATE_FILE`. |
| `GV_ROUTER_TRUSTED_ANNOUNCE_PEERS=timer-endpoint` | Extra peers allowed to announce routes. The opencode runtime peer is added automatically. Aliases: `VEIN_ROUTER_TRUSTED_ANNOUNCE_PEERS`, `OSG_ROUTER_TRUSTED_ANNOUNCE_PEERS`. |
| `GV_ROUTER_URL=ws://127.0.0.1:4090` | Explicit external router URL; disables the built-in router by default unless `GV_INTERNAL_ROUTER=true`. Aliases: `VEIN_ROUTER_URL`, `OSG_WS_URL`. |

External endpoints, including the Rust Timer endpoint, should connect to this
router URL. With defaults, use `ws://127.0.0.1:7240`.

Config file (`~/.config/opencode-vein-plugin-config.json`) supports the same server-level shape:

```json
{
  "runtimeID": "vein_local_user",
  "internalRouter": {
    "enabled": true,
    "port": 7241,
    "bindHost": "127.0.0.1",
    "upstreamUrls": ["ws://127.0.0.1:4090"],
    "stateFilePath": "~/.config/opencode-vein-plugin/logs/internal-router-state.json",
    "trustedAnnouncePeers": ["timer-endpoint"]
  }
}
```

### Timer MCP

The Timer endpoint exposes its own HTTP MCP server. Point the plugin at that
server to make opencode sessions see the `timer_scheduler` MCP tools:

```bash
GV_TIMER_MCP_URL=http://127.0.0.1:8789 opencode run --model xiaomi/mimo-v2.5-pro "create a timer"
```

If the value is only a host URL, the plugin appends `/mcp/timer_scheduler`.
The generated MCP entry is remote, OAuth-disabled, enabled by default, and gets
`runtimeID` plus `instanceWorkspaceDirectory` query parameters automatically.
`ExecutorSessionID` is still injected by opencode at tool execution time; Timer
only requires it as the first tool argument.

Timer MCP environment variables:

| Variable | Description |
|---|---|
| `GV_TIMER_MCP_URL=http://127.0.0.1:8789` | Timer MCP server URL. Aliases: `VEIN_TIMER_MCP_URL`, `OSG_TIMER_MCP_URL`. |
| `GV_TIMER_MCP_ENABLED=false` | Disable the managed Timer MCP entry. Aliases: `VEIN_TIMER_MCP_ENABLED`, `OSG_TIMER_MCP_ENABLED`. |
| `GV_TIMER_MCP_NAME=timer_scheduler` | MCP config name. Aliases: `VEIN_TIMER_MCP_NAME`, `OSG_TIMER_MCP_NAME`. |
| `GV_TIMER_MCP_SOURCE_ID=timer-endpoint` | Source metadata for status/display. Aliases: `VEIN_TIMER_MCP_SOURCE_ID`, `OSG_TIMER_MCP_SOURCE_ID`. |

### Direct WS client usage

```typescript
import { GlassveinWsClient } from "@opensessiongateway/opencode-vein-plugin/glassvein-router"

const client = new GlassveinWsClient({
  routerUrl: "ws://127.0.0.1:7200",
  nodeId: "alpha-client",
  domain: "domain-a",
  runtime: "runtime-alpha",
  session: "session-alpha",
})

await client.connect()
client.sendWorkspaceRegister()
// Use processEvent via createGvPlugin for OSGP-compliant mapping,
// or call sendOpencodeEvent directly for explicit session_update / requestion events.
client.disconnect()
```

## Exports

| Export path | Description |
|---|---|
| `@opensessiongateway/opencode-vein-plugin` | opencode server plugin entry |
| `@opensessiongateway/opencode-vein-plugin/server` | explicit opencode server plugin entry |
| `@opensessiongateway/opencode-vein-plugin/entry` | explicit opencode server plugin entry |
| `@opensessiongateway/opencode-vein-plugin/index` | helper/API re-exports |
| `@opensessiongateway/opencode-vein-plugin/glassvein-router` | GlassVein WS client |
| `@opensessiongateway/opencode-vein-plugin/gvplugin` | compatibility alias for the opencode plugin entry |

## Development

```bash
npm run typecheck  # Type check
npm run build      # Compile TypeScript
npm run pack:local # Generate .tgz
```

## License

MIT
