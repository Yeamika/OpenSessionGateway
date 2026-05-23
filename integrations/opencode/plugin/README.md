# @opensessiongateway/opencode-vein-plugin

GlassVein opencode plugin — independent WS client for GlassVein router integration.

Location: `integrations/opencode/plugin/`

## Overview

This package provides a minimal WebSocket client for connecting opencode workspace instances to the GlassVein Rust router. It is designed to be used as an opencode plugin.

## Architecture

- **One TS client per workspace** (keyed by `ctx.directory`)
- **Rust router is a singleton** (single process, multiple workspace connections)
- **Wire protocol follows OSGP (OpenSessionGateway Protocol)**:
  - SessionEnvelope with `type/subtype` routing (no `kind` field on wire).
  - `type` ∈ {`upload`, `control`, `request`, `response`}.
  - `subtype` carries the semantic event name (e.g., `session_update`, `requestion.asked`).
- **Client sends** (`type=upload`): hello, workspace/register, session_update, requestion.asked/resolved.
- **Client receives** (`type=control`): control commands → dispatches to existing manager/ctx via `subtype`.
- `control.command` / permission / question do NOT have independent main chains; all use `type/subtype`.
- Detailed opencode message content (message.updated, message.part.updated, etc.) is NOT sent as wire upload; retained for local state tracking only.

## Installation

```bash
npm install @opensessiongateway/opencode-vein-plugin
```

## Usage

### As an opencode plugin

```typescript
import { createGvPlugin } from "@opensessiongateway/opencode-vein-plugin/gvplugin"

const plugin = createGvPlugin(ctx, {
  routerUrl: "ws://127.0.0.1:7200",
  nodeId: "alpha-client",
  domain: "domain-a",
  runtime: "runtime-alpha",
  session: "session-alpha",
})

await plugin.connect()

// Send opencode events (mapper converts to OSGP session_update / requestion subtypes)
plugin.processEvent({
  type: "session.status",
  properties: { status: { type: "idle" }, sessionID: "ses-1" },
})

// Listen for control commands (OSGP: type=control, subtype=command_name)
plugin.client.onControlCommand((command) => {
  console.log("Control:", command.subtype, command.payload)
})

// Disconnect
plugin.disconnect()
```

### Direct WS client usage

```typescript
import { GlassveinWsClient } from "@opensessiongateway/opencode-vein-plugin/glassvein-router"

const client = new GlassveinWsClient({
  routerUrl: "ws://127.0.0.1:7200",
  nodeId: "alpha-client",
  role: "client",
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
| `@opensessiongateway/opencode-vein-plugin` | Main entry (re-exports all) |
| `@opensessiongateway/opencode-vein-plugin/glassvein-router` | GlassVein WS client |
| `@opensessiongateway/opencode-vein-plugin/gvplugin` | opencode plugin interface |

## Development

```bash
npm run typecheck  # Type check
npm run build      # Compile TypeScript
npm run pack:local # Generate .tgz
```

## License

MIT
