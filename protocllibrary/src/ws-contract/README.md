`ws-contract` is the server-to-client control contract layer.

Rules:

- keep only shared contracts here
- one route uses one flat file, for example `CurrentClient.ts`
- server implementation stays in server code
- client implementation stays in each client runtime code

So `ws-contract` only provides types, payload creators, and payload readers.
