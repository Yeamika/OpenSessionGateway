# glassvein-router

`glassvein-router` is a small npm wrapper around the GlassVein router binary.

GlassVein is only a session-envelope forwarding layer: it accepts router/client/surface WebSocket peers, exchanges route announcements, and forwards opaque session-related envelopes by `domain/runtime/session` address. It does not provide MCP, plugin hosting, mailbox storage, timers, IM adapters, or business payload interpretation.

## Install

```bash
npm install -g glassvein-router
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
