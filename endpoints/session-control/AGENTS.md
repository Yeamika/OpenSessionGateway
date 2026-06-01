# SessionControl Endpoint

Session management and control endpoint for GlassVein router.

## Responsibilities
- Session lifecycle management (create, list, destroy)
- Prompt injection via `control.add_prompt`
- Session state queries
- Link handshake with router (new permission-gate model)

## Permission Requirements
- `announce.route` — register endpoint with router
- `control.add_prompt` — send prompts to sessions
- `session.list` — list active sessions
- `session.read` — read session state/messages
- `route.list` — list routes (read-only)

## Architecture
- Connects to GlassVein router via WebSocket
- Uses `LinkHandshake` (no legacy role/capabilities)
- All control operations go through router permission gate
- No direct admin rule writing — use Console endpoint or admin.request pattern
