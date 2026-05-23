# glassvein-router

`glassvein-router` is a small npm wrapper around the GlassVein router binary.

GlassVein is only a session-envelope forwarding layer: it accepts router/client/surface WebSocket peers, exchanges route announcements, and forwards opaque session-related envelopes by `domain/runtime/session` address. It does not provide MCP, plugin hosting, mailbox storage, timers, IM adapters, or business payload interpretation.

## Install

```bash
npm install -g @opensessiongateway/glassvein-router
```

## Run

```bash
glassvein-router --node-id root --bind 0.0.0.0:4090
```

Connect to upstream routers:

```bash
glassvein-router \
  --node-id edge-a \
  --bind 0.0.0.0:4091 \
  --upstream ws://127.0.0.1:4090
```

Announce a local route:

```bash
glassvein-router --route domain-a/runtime-a/session-a
```

Or use a JSON config:

```json
{
  "nodeId": "edge-a",
  "bindAddr": "0.0.0.0:4091",
  "upstreamUrls": ["ws://127.0.0.1:4090"],
  "announceRoutes": [
    { "domainId": "domain-a", "runtimeId": "runtime-a", "sessionId": "session-a" }
  ]
}
```

```bash
glassvein-router --config glassvein-router.json
```

## Supported npm binary targets

Only these three targets are packaged:

- `win32-x64`
- `linux-x64`
- `linux-arm64`

Set `GLASSVEIN_ROUTER_BINARY=/path/to/glassvein-router` to override the bundled binary during local testing.

## Dist staging & npm pack

The npm package ships platform-specific pre-built binaries under `dist/`. To stage a locally-built binary:

```bash
# 1. Build the Rust binary (from GlassVein root)
cargo build --release -p glassvein-router-cli

# 2. Stage it into dist/linux-x64/ (default target)
cd packages/glassvein-router
npm run stage:local
# Or: ./scripts/stage-local.sh
# Cross-arch example: TARGET=linux-arm64 ./scripts/stage-local.sh

# 3. Verify npm pack includes everything
npm pack --dry-run
```

`npm pack --dry-run` should list:

- `bin/` — the Node.js launcher
- `dist/linux-x64/glassvein-router` — the staged binary
- `README.md` and `package.json`

To override the source binary path, set `GLASSVEIN_ROUTER_BINARY`:

```bash
GLASSVEIN_ROUTER_BINARY=../../target/release/glassvein-router node bin/glassvein-router.js --help
```
