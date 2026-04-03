# OSG Protocol vs Server vs Client Status Notes

## Why This Exists

A recurring OSG maintenance risk is collapsing three different things into one statement:

1. protocol shape,
2. server routing,
3. client implementation.

This note keeps them separate.

## How To Read This

For each capability below, ask three questions:

- Is the protocol or WS event shape defined?
- Does the server route or consume it today?
- Is there in-repo client evidence beyond a type definition?

## Current Matrix

| Capability                                        | Protocol layer                | Server layer                                                                         | Client evidence                                                              | Notes                                                                     |
| ------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `ClientContentExecuteing`                         | Defined in `protocol-library` | Consumed in `server/lib/v2/ws/ws-event.ts` and cached in `server/lib/v2/ws/index.ts` | `client-template` and `client-opencode-plugin-v2` both emit/report it        | Main source of session activity and live runtime rows                     |
| `AddPromot` / MCP `AddPrompt`                     | Defined in `protocol-library` | Routed through WS helpers and exposed by `runtime_control`                           | `client-template` and `client-opencode-plugin-v2` both handle it             | Current meaning is user `msg` plus optional `model` and per-turn `system` |
| `CreateNewSession`                                | Defined in `protocol-library` | Routed by `runtime_control`                                                          | `client-template` and `client-opencode-plugin-v2` both handle it             | Also used by IM gateway session-binding creation                          |
| `GetSessionMsg`                                   | Defined in `protocol-library` | Routed by WS helpers and exposed by `session_bridge`                                 | `client-template` and `client-opencode-plugin-v2` both handle it             | Used for live session message retrieval                                   |
| `SetClientDisplaySession`                         | Defined in `protocol-library` | Routed by `runtime_control`                                                          | `client-template` and `client-opencode-plugin-v2` both handle it             | Display-targeted session switch                                           |
| `AbortSessionOfClient` / MCP `AbortClientSession` | Defined in `protocol-library` | Routed by `runtime_control`                                                          | `client-template` and `client-opencode-plugin-v2` both handle it             | Session abort control path                                                |
| `RequestRuntime`                                  | Defined in `protocol-library` | Routed by WS helpers and exposed by `runtime_control`                                | `client-template` and `client-opencode-plugin-v2` both handle it             | Used to refresh runtime-side current snapshot                             |
| Permission asked / updated / resolve              | Defined in `protocol-library` | Server stores permission records and exposes permission tools                        | `client-template` and `client-opencode-plugin-v2` both contain resolve paths | Separate live state plane from session messages                           |
| `ServerToast`                                     | Defined in `protocol-library` | Emitted by server WS helpers                                                         | `client-template` and `client-opencode-plugin-v2` both handle it             | UI meaning remains client-specific                                        |

## Current Interpretations

### `ClientContentExecuteing` is the key live-state input

The current gateway learns most session activity, display association, and instance-workspace context from `ClientContentExecuteing`.
If clients stop reporting it correctly, the live view becomes thin or misleading.

### MCP surfaces are not the same as WS protocol events

MCP surfaces are plugin-backed HTTP layers served from `/api/v2/mcp/[surface]`.
They often trigger WS events under the hood, but they are a separate server interface with their own availability rules.

### `RequestCurrentInfo` should not be treated as current core behavior

The current docs should not present `RequestCurrentInfo` as an active center of truth refresh.
The current server state model is driven by WS queue caches and `ClientContentExecuteing`.

## Practical Rule

When someone says "OSG supports X", translate that into:

1. protocol defines X,
2. server routes or consumes X,
3. at least one client here actually implements X.

Only then should docs present X as a stable end-to-end capability.
