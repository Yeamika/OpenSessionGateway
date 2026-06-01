# console-endpoint

GlassVein htop-like TUI management endpoint for session viewing and control.

## Overview

`console-endpoint` is a human-operated terminal interface that aggregates session state from the GlassVein router network and provides interactive control capabilities. It merges the former viewer (session aggregation) and control (command sender) into a single unified endpoint.

The wire path uses canonical OSGP: address-level `source`/`target` and `upload`/`control`/`request`/`response` message types.

## Features

- **htop-style TUI** — real-time session table with runtime ID, session ID, title, state, last update, and summary columns
- **Session aggregation** — tracks session updates, requestion (pending questions/permissions), and snapshot responses
- **Interactive commands** — navigate sessions with `j`/`k`, send control commands and read requests to selected sessions
- **Three run modes** — interactive TUI, one-shot smoke test, and single-command execution
- **Config file support** — JSON config file with all options

## Installation

Build from the GlassVein workspace:

```bash
cargo build -p console-endpoint
```

## Usage

### TUI Mode (default)

```bash
# Connect to local router with defaults
cargo run -p console-endpoint

# Custom router and target
cargo run -p console-endpoint -- \
  --router-url ws://127.0.0.1:7200 \
  --address domain-a/console-runtime/console \
  --target domain-a/runtime-alpha/session-alpha
```

### One-Shot Mode

Collects session state for a fixed duration, then prints a snapshot:

```bash
cargo run -p console-endpoint -- --once --smoke-duration-ms 3000
```

### Command Mode

Sends a single command or request, waits for response, then exits:

```bash
# Send a request
cargo run -p console-endpoint -- --command-mode \
  --command runtime_session_view_snapshot \
  --target domain-a/runtime-alpha/session-alpha

# Send a control command
cargo run -p console-endpoint -- --command-mode \
  --command add_prompt \
  --message "hello from console" \
  --target domain-a/runtime-alpha/session-alpha
```

### Config File

```bash
cargo run -p console-endpoint -- --config console-config.json
```

Example `console-config.json`:

```json
{
  "mode": "tui",
  "nodeId": "console-endpoint",
  "routerUrl": "ws://127.0.0.1:7200",
  "address": "domain-a/console-runtime/console",
  "target": "domain-a/runtime-alpha/session-alpha",
  "refreshIntervalMs": 1000,
  "smokeDurationMs": 1500,
  "command": "runtime_session_view_snapshot",
  "message": ""
}
```

## CLI Options

| Option | Default | Description |
|--------|---------|-------------|
| `--config <file>` | — | Load options from JSON config file |
| `--once` / `--smoke` | — | One-shot mode: collect then print |
| `--command-mode` / `--send` | — | Single command mode |
| `--router-url <ws>` | `ws://127.0.0.1:7200` | Router WebSocket URL |
| `--node-id <id>` | `console-endpoint` | Node identifier |
| `--address <d/r/s>` | `domain-a/console-runtime/console` | This endpoint's address |
| `--target <d/r/s>` | `domain-a/runtime-alpha/session-alpha` | Default target address |
| `--refresh-interval-ms <ms>` | `1000` | TUI refresh interval (min 100) |
| `--smoke-duration-ms <ms>` | `1500` | One-shot collection duration (min 100) |
| `--command <cmd>` | `runtime_session_view_snapshot` | Command to execute |
| `--message <text>` | — | Message payload for commands |

## TUI Key Commands

| Key/Command | Action |
|-------------|--------|
| `j` / `down` | Move selection down |
| `k` / `up` | Move selection up |
| `view` | Request session view snapshot |
| `messages` | Request session messages |
| `requestions` | Request requestion snapshot |
| `workspace` | Request workspace view snapshot |
| `abort` | Send abort command |
| `resume` | Send resume command |
| `compact` | Send compact command |
| `prompt <text>` | Send add_prompt command |
| `rename <title>` | Send rename command |
| `create <prompt>` | Send create session command |
| `q` / `quit` / `exit` | Exit TUI |

## Admin Commands (TUI)

| Command | Action |
|---------|--------|
| `admin routes` | List all routes |
| `admin routes manual` | List manual routes only |
| `admin rules` | List all rules |
| `admin revision` | Query route/rule revision counters |
| `admin route add <addr> <neighbor> <dist>` | Add a manual route |
| `admin route remove <addr> <neighbor>` | Remove a manual route |
| `admin rule remove <id>` | Remove a rule |

Admin commands in command mode: `--command admin_route_list`, `--command admin_rule_list`, etc.

## Control Commands

| Command | Description |
|---------|-------------|
| `add_prompt` | Add a user prompt to a session |
| `abort_session` | Abort a running session |
| `compact_session` | Trigger session compaction |
| `resume_session` | Resume a paused session |
| `rename_session` | Rename a session |
| `create_session` | Create a new session |

## Read Requests

| Request | Description |
|---------|-------------|
| `runtime_session_view_snapshot` | Get session state snapshot |
| `runtime_session_messages` | Get session message history |
| `runtime_workspace_view_snapshot` | Get workspace overview |
| `runtime_requestion_snapshot` | Get pending requestions |

## Address Format

Addresses follow the pattern `domain[/runtime[/session]]`:

- `domain-a` — domain only (wildcard runtime and session)
- `domain-a/runtime-alpha` — domain + runtime (wildcard session)
- `domain-a/runtime-alpha/session-alpha` — full address

## Dependencies

- `osgp` — OSGP protocol types
- `surface` — Control/observer surface library
- `tokio` — Async runtime
- `tokio-tungstenite` — WebSocket client
- `futures-util` — Stream utilities
- `tracing` / `tracing-subscriber` — Logging

## Testing

```bash
# Run all tests
cargo test -p console-endpoint

# Run with output
cargo test -p console-endpoint -- --show-output
```

Test coverage includes:
- State aggregation (session updates, requestion tracking)
- Empty state handling
- Large session count (100+ sessions)
- Address parsing (valid and invalid formats)
- Control and request envelope construction
- Boundary values (truncation, special characters, empty payloads)
- Error handling (unsupported commands, event buffer capping)

## Fake Client

A Node.js test helper is available at `tools/fake-client.mjs`:

```bash
node tools/fake-client.mjs --router-url ws://127.0.0.1:7200
```

This creates a fake endpoint that sends periodic session updates and responds to read requests and control commands.

## Local Development: Router Grant Setup

To use admin commands, the router must grant permissions to the console endpoint. A sample state-file is provided at `tools/dev-state-file.json`.

### Using the sample state-file

```bash
# Start router with the dev state-file
cargo run -p router -- --state-file endpoints/console/tools/dev-state-file.json
```

This pre-grants `console-endpoint` the following persistent permissions:
- `admin.routes.read` / `admin.routes.write`
- `admin.rules.read` / `admin.rules.write`
- `announce.route`
- `read.runtime_session_messages`

### Grant format

```json
{
  "persistent_grants": [
    { "peer_id": "console-endpoint", "op": "admin.routes.read", "kind": "persist" },
    { "peer_id": "console-endpoint", "op": "admin.routes.write", "kind": "persist" }
  ]
}
```

The `peer_id` must match the `--node-id` used by the console endpoint. The `kind` can be `persist` (survives restart), `once` (single use), or `ttl` with `seconds`.

## Architecture

```
┌─────────────────────────────────────────────┐
│              console-endpoint               │
├──────────┬──────────┬───────────┬───────────┤
│  config  │  client  │   state   │    tui    │
│          │          │           │           │
│ CLI args │ WS conn  │ Session   │ Render +  │
│ JSON cfg │ msg send │ aggregate │ input     │
│          │ msg recv │ rows      │           │
├──────────┴──────────┼───────────┴───────────┤
│    control.rs       │     request.rs        │
│ build control msgs  │  build read requests  │
└─────────────────────┴───────────────────────┘
                       │
                       ▼
               GlassVein Router
```
