# @opensessiongateway/client-library

Simple class-based runtime library for OSG clients.

Exports:

- `OSGClient`: unified logger + WebSocket client

Design rules:

- no global state
- multi-instance safe
- caller must initialize instances explicitly

Example:

```js
import { OSGClient } from "@opensessiongateway/client-library";

const client = new OSGClient(
  {
    wsServerUrl: "ws://127.0.0.1:4088/api/v2/wsport",
    runtimeID: "run_example_001",
    hostName: "local-dev",
    logStream: process.stdout,
  },
  {
    showToast(type, message, subtitle) {
      console.log(`[${type}] ${message}`);
      if (subtitle) console.log(`  subtitle: ${subtitle}`);
    },
  },
);

client.start();
```

Connection is treated as successful only after server ack:

```json
{"type":"connected","runtimeID":"<same runtimeID>"}
```
