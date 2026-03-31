# OSG Project Overview

## What OSG Is

OSG (OpenSessionGateway) is a session-oriented runtime gateway system.
It is designed to connect runtime clients, keep track of their sessions and workspaces, and expose those capabilities through HTTP and WebSocket interfaces.

At a high level, OSG sits between:

- runtime clients that maintain active execution contexts,
- external control or bridge layers that need to send prompts and fetch session output,
- integration layers such as Feishu and OpenCode-related plugins.

## Top-Level Project Layout

Current workspace root:

- `OpenSessionGateway/`
  - `server/`
  - `packages/`
    - `protocol-library/`
    - `client-library/`
    - `client-opencode-plugin-v2/`
    - `client-template/`
    - `server-plugin-sdk/`
  - `plugins/`

Related sibling directories outside this workspace root also exist under `/mnt/data/OPENCODE_AUTO`, including `OSG-Claw/`, `Yaemio/opencode/`, and build output directories, but the main OSG system currently centers on `OpenSessionGateway/`.

## Main Modules

### server

The `server/` package is the central OSG service.
It runs a Next.js-based application with a custom Node HTTP server and a WebSocket upgrade path.

Current confirmed responsibilities include:

- serving the main HTTP application,
- handling WebSocket runtime connections at `/api/v2/wsport`,
- exposing MCP-style HTTP endpoints under `/api/v2/mcp/...`,
- maintaining in-memory runtime queue state,
- tracking runtime/session/workspace-related state.

### packages/protocol-library

The `packages/protocol-library/` package defines shared protocol structures used across the system.
It includes:

- generic WebSocket envelope types,
- connected / ping / error event payloads,
- session and runtime-related request/response payload creators and readers.

This package is a contract layer between server-side and client-side OSG components.

### packages/client-library

The `packages/client-library/` package provides a reusable OSG client implementation.
Its main exported abstraction is `OSGClient`, which wraps:

- WebSocket connection setup,
- runtime registration parameters,
- logging,
- reconnect behavior,
- request/response handling for server-originated events.

### packages/client-opencode-plugin-v2

This package appears to be the OpenCode-facing plugin integration for OSG.
It creates an OSG-aware hook client that:

- starts an OSG runtime connection,
- provides tool integration,
- applies MCP-related config,
- reacts to external events,
- cleans up on shutdown.

### plugins

The `plugins/` directory stores package-style OSG server plugins.
It currently includes a generic IM bridge plugin alongside MCP surface plugins such as runtime control and session bridge.

The IM bridge's role is to:

- host third-party IM provider adapters under `plugins/`,
- expose a shared upload port and MCP control surface,
- keep provider image keys hidden behind internal `uploadID` values,
- let provider-specific modules handle native IM API details.

The bridge now lives under `plugins/IM-bridge/`, with Feishu implemented as a provider module under `plugins/IM-bridge/plugins/feishu/`.

### packages/client-template

This package is a minimal template for building new OSG-connected clients.
It exists to make future integrations easier and more consistent.

## Current Design Direction

Based on source inspection, OSG is built around the following idea:

1. runtime clients connect into the gateway over WebSocket,
2. the gateway maintains state and event queues for those runtimes,
3. external systems interact with runtimes and sessions through HTTP MCP endpoints,
4. bridge layers adapt third-party chat or tool ecosystems into the OSG session model.

This means OSG is best understood as a runtime/session coordination layer rather than a simple chat bot backend or a generic proxy.

## Current State of the Docs

The repository already contains small package README files, but a full system-level explanation is still incomplete.
The documents in this directory are intended to fill that gap.
