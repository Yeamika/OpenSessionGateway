# ws-event note

`client-library` no longer mirrors server ws-event implementation files.

Current role:

- keep only generic websocket transport handling in `client-library`
- keep shared contracts in `@opensessiongateway/protocol-library`
- keep concrete server-event implementations in each client runtime/plugin
