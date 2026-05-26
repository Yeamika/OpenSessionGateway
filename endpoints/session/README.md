# Session Endpoint Redirect

The old combined `endpoints/session` crate has been split and is no longer an
active endpoint crate.

Use these endpoints instead:

- `../session-control/` — GV router connection, session state, session
  request/control API, web UI, `ListLivingSessions`, and `GetSessionMessages`.
- `../mailbox/` — mailbox MCP/API tools such as List/Read/Send/Reply/Delete
  mailbox item operations.

This directory is intentionally kept as a redirect note only to avoid confusion
while downstream references are updated. It is not listed in the Cargo
workspace and contains no Rust crate.
