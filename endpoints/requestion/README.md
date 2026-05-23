# requestion-endpoint

`requestion-endpoint` is the GlassVein endpoint project for requestion monitoring, snapshot queries, web review, and approval/response actions.

## Boundary

- Runs as an OSGP `endpoint` with `surface_viewer` capability; it is not a router role.
- Connects to the GV router over WebSocket and listens for canonical requestion uploads.
- Keeps requestion/session state in this endpoint process; the router remains stateless for these business views.
- Sends approvals/rejections/replies as canonical OSGP `control` envelopes with subtype `requestion_respond`.
- Does not change `core`, `router`, `osgp`, or Rust clients, and does not add separate permission/question protocol paths.

## Layers

- `src/main.rs` — process composition: CLI, GV WebSocket connection, cache sharing, and task startup.
- `src/handler.rs` — incoming GV envelope/read-request handling and cache mutation.
- `src/cache.rs` — in-memory requestion/session state model.
- `src/gv_client.rs` — outbound `requestion_respond` control envelope construction.
- `src/web.rs` — minimal HTTP server for web assets, JSON API, and MCP-style tool API.
- `web/` — static browser UI served by this endpoint process.

## Start

```sh
cargo run -p requestion-endpoint -- --config endpoints/requestion/config.example.json
```

Copy `config.example.json` to a local untracked config file and edit router/address/web settings as needed. Open `http://127.0.0.1:7318/` for the web UI. Use `--no-web` to run only the GV cache/snapshot endpoint. Use `--seed-demo` only for local demo data.

## GV mapping

The endpoint monitors uploads with canonical `linkType="upload"` subtypes:

- `requestion_asked`
- `requestion_updated`
- `requestion_resolved`
- `requestion_cancelled`

Compat dotted requestion kinds are still accepted locally for older emitters. New outbound actions are canonical controls:

```json
{
  "linkType": "control",
  "subtype": "requestion_respond",
  "source": { "domain": "domain-a", "runtime": "requestion-endpoint", "session": "requestion-endpoint" },
  "target": { "domain": "...", "runtime": "...", "session": "..." },
  "payload": {
    "sessionID": "...",
    "requestID": "...",
    "requestionId": "...",
    "decision": "approve|reject|response",
    "response": "...",
    "answers": [["..."]]
  }
}
```

`target` is copied from the original requestion upload source address when present.

## HTTP and MCP-style API

- `GET /` — web UI.
- `GET /api/config` — current effective runtime config.
- `POST /api/config/reload` — hot reload from `--config` path without clearing caches.
- `GET /api/requestions` — pending cache snapshot with flat `requestions` and `groupedBySession` views.
- `POST /api/respond` — JSON body with `sessionId`, `requestId`, `decision`, `response`, optional `answers`.
- `POST /mcp` — JSON-RPC-like API supporting `tools/list` and `tools/call` for `list_requestions` / `respond_requestion` / `ReloadConfig`.
  `respond_requestion` requires `ExecutorSessionID` for approver attribution and accepts optional `ExecutorRuntimeID` (or MCP `params.runtimeID` convention) without changing the OSGP response target.

## Manual validation

1. Run the endpoint with a router URL and open the web UI.
2. Emit `requestion_asked`; confirm it appears with source runtime/session and payload.
3. Approve/reject/respond from the page; confirm the endpoint sends `requestion_respond` to the original source address.
4. Emit `requestion_resolved` or `requestion_cancelled`; confirm the pending item is removed.
5. Optional API check: `curl http://127.0.0.1:7318/api/requestions`.
