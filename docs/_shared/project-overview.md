# OSG Project Overview

## What OSG Is

OSG (OpenSessionGateway) is a session-oriented runtime gateway.
It connects runtime clients over WebSocket, reconstructs live runtime and session state in memory, and exposes that state through plugin-backed MCP HTTP surfaces and monitoring endpoints.

At a high level, OSG sits between:

- runtime clients that maintain active execution contexts,
- control layers that need to inspect or drive runtimes and sessions,
- plugin integrations such as OpenCode and IM gateway adapters.

## Top-Level Layout

Current workspace root:

- `OpenSessionGateway/`
  - `agents/`
  - `docs/`
  - `packages/`
  - `plugins/`
  - `server/`
  - `web/`

## Main Modules

### `server/`

`server/` is the central gateway service.
It serves a small landing page, accepts runtime WebSocket connections at `/api/v2/wsport`, exposes plugin-backed MCP surfaces at `/api/v2/mcp/[surface]`, streams live monitor data at `/api/monitor/stream`, and runs the local plugin admin server.

Its live runtime, session, instance-workspace, display, and permission state is mostly reconstructed in memory.

### `web/`

`web/` is the main interactive monitor/admin UI.
It proxies `/api/*` requests to the gateway origin and consumes the gateway monitor SSE stream from `/api/monitor/stream`.

### `packages/protocol-library/`

This package defines shared WS protocol structures and payload helpers used across server and client code.
It is the contract layer, not the implementation layer.

### `packages/client-library/`

This package exports `OSGClient`, the reusable runtime client wrapper for OSG WebSocket connections, request handling, logging, and reconnect behavior.

### `packages/client-opencode-plugin-v2/`

This package connects an OpenCode environment to OSG.
It starts an OSG runtime client, reports runtime and session state, and handles server-originated WS requests such as `AddPromot`, `CreateNewSession`, `GetSessionMsg`, `RequestRuntime`, and permission flows.

### `packages/client-template/`

This is the reference example client and smoke-test client for OSG WS behavior.
It is useful for validating protocol and server assumptions.

### `packages/server-plugin-sdk/`

This package defines the server plugin manifest, lifecycle, storage, and MCP surface APIs used by `server/` plugins.

### `plugins/`

`plugins/` stores package-style OSG server plugins loaded from configured plugin roots.
Current repo-shipped plugin packages include:

- `runtime-control`
- `session-bridge`
- `timer-scheduler`
- `IM-gateway`
- `_examples/echo-surface`

### `plugins/IM-gateway/`

`IM-gateway` is the current IM integration package.
It starts its own local HTTP transfer server, exposes `im_gateway_control` and `im_gateway_chat` MCP surfaces when loaded, and currently ships a builtin `feishu` provider under `plugins/IM-gateway/plugins/feishu/`.

## Current Design Direction

The current implementation follows this flow:

1. runtime clients connect to the gateway over WebSocket,
2. the gateway caches live runtime state and activity in memory,
3. MCP surfaces are registered by plugins and served through `/api/v2/mcp/[surface]`,
4. integrations such as OpenCode and IM gateway adapt external tools into the OSG runtime and session model.

OSG is best understood as a runtime and session coordination layer, not as a thin proxy and not as a single chat application.
