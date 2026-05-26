# Session Control Endpoint

Session management/control endpoint for GV router connection, session update
state, web/API/MCP, ListLivingSessions, GetSessionMessages, canonical session
requests, and canonical session controls.

Mailbox CRUD tools are intentionally not included here; they belong to the
separate `endpoints/mailbox/` endpoint.

Run with a config file:

```bash
cargo run -p session-control-endpoint -- --config endpoints/session-control/config.example.json
```
