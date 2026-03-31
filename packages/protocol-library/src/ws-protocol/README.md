`ws-protocol` is the shared websocket protocol layer.

Rules:

- keep only shared contracts here
- one route uses one flat file, for example `CurrentClient.ts`
- server implementation stays in server code
- client implementation stays in each client runtime code

So `ws-protocol` only provides types, payload creators, and payload readers.
