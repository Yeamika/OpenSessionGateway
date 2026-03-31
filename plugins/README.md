# OSG Server Plugins

This directory stores package-style server plugins.

This is the canonical plugin source tree in this repo. Point the server here with `OSG_PLUGIN_DIRS` if you want to use the repo-shipped plugins.

## Recommended Form

Each plugin should live in its own folder:

```text
plugins/
  my-plugin/
    package.json
    index.ts
```

## `package.json`

```json
{
  "name": "@opensessiongateway/osg-plugin-my-plugin",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "osgServerPlugin": {
    "entry": "./index.ts",
    "autoload": true
  }
}
```

## `index.ts`

```ts
import type { OsgServerPlugin } from "@opensessiongateway/server-plugin-sdk";

const plugin: OsgServerPlugin = {
  manifest: {
    id: "example.my-plugin",
    version: "0.1.0",
    name: "My Plugin",
    description: "Adds one MCP surface",
  },
  activate(ctx) {
    ctx.mcp.registerSurface({
      id: "example.my-plugin.surface",
      routeSegment: "my_surface",
      info() {
        return {
          ok: true,
          endpoint: "/api/v2/mcp/my_surface",
          server: "my_surface",
          implemented: true,
          description: "Example package plugin",
        };
      },
      async handleRpc(body) {
        const id = body && typeof body === "object" ? (body as { id?: unknown }).id ?? null : null;
        return Response.json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
          },
        });
      },
    });
  },
};

export default plugin;
```

## Shared SDK

- Source package: `packages/server-plugin-sdk/`
- Import name: `@opensessiongateway/server-plugin-sdk`

## Autoload Behavior

- Direct child folders are auto-loaded at server startup.
- Root config file `osg.plugins.json` can define the default autoload allow/deny list.
- Set `osgServerPlugin.autoload` to `false` in a plugin package to keep it opt-in.
- Folders starting with `_` are ignored by autoload.
- The admin page can still load ignored packages manually.
- `OSG_PLUGIN_AUTOLOAD_ALLOW` limits autoload to named package directories.
- `OSG_PLUGIN_AUTOLOAD_DENY` skips named package directories.

Example root config:

```json
{
  "autoload": {
    "allow": ["IM-bridge", "runtime-control", "session-bridge", "timer-scheduler"]
  }
}
```

Example env override:

```bash
OSG_PLUGIN_DIRS=D:\ai\OPENCODE_AUTO\OpenSessionGateway\plugins
OSG_PLUGIN_AUTOLOAD_ALLOW=IM-bridge,runtime-control,session-bridge,timer-scheduler
```

## Current Packages

- `IM-bridge/`
- `IM-gateway/`
- `runtime-control/`
- `session-bridge/`
- `timer-scheduler/`
- `_examples/echo-surface/`
