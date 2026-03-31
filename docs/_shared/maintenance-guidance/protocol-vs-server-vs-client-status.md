# OSG Protocol vs Server vs Client Status Notes

## Why This Exists

A recurring OSG maintenance risk is assuming that a named protocol event is already a fully working end-to-end feature.
That assumption is often too optimistic.

This document separates three layers:

1. protocol definition,
2. server-side routing/handling,
3. client-side implementation evidence currently observed in this workspace.

It is a working map from code inspection, not a final certification matrix.

## How To Read This

For each capability below, ask three separate questions:

- Is the protocol/event shape defined?
- Does the server route or consume it?
- Is there a real client implementation here that appears to honor it meaningfully?

Do not collapse those into one yes/no answer.

## Status Table

| Capability | Protocol layer | Server layer | Client evidence in current workspace | Current confidence |
| --- | --- | --- | --- | --- |
| `ClientContentExecuteing` | Defined in `protocol-library` | Consumed in `server/lib/v2/ws/ws-event.ts` to rebuild workspace/session/display state | No full production client confirmed yet; template/protocol support exists around WS event handling | medium |
| `RequestCurrentInfo` | Defined in `protocol-library` | Handler exists, but server-side polling/request loop is currently commented out | `client-template` responds to it | medium |
| `ListSession` | Request/response payloads defined | Server can emit request and cache last session list | `client-template` routes event to a handler, but real completeness still unverified | low-to-medium |
| `AddPromot` | Defined in `protocol-library` | Server can emit request toward runtime and expose it through MCP/session bridge paths | `client-template` currently only returns `{ accepted: true }`, so template is not proof of full behavior | low |
| `GetSessionMsg` | Defined in `protocol-library` | Server can request it and bridge code depends on it | `client-template` routes to handler, but real message semantics still need validation | low-to-medium |
| `CreateNewSession` | Defined in `protocol-library` | Server emits request from runtime control tools | No convincing real client behavior confirmed yet from current reading | low |
| `SetClientDisplaySession` | Defined in `protocol-library` | Server emits request from runtime control tools | Template routes it, but real implementation depth still unclear | low |
| `AbortSessionOfClient` | Defined in protocol package | Server emits request from runtime control tools | Template routes it; production behavior still not validated | low-to-medium |
| `ServerToast` | WS event shape effectively used by server | Server emits it | Template accepts it; UI semantics depend on client | medium |

## Important Interpretations

### 1. `ClientContentExecuteing` currently looks like the most architecturally important event

Even without proving every other tool path, current server code makes this event structurally important because it rebuilds or refreshes visible live runtime state:

- workspace association,
- session association,
- display association,
- session title/status.

If this event is absent, delayed, or only partially implemented by a client, the server's live view can become thin or misleading.

### 2. `RequestCurrentInfo` exists, but is not currently the center of truth refresh

The protocol exists.
The template client can answer.
But the server's own polling/request loop is commented out.

That means maintainers should be careful not to describe OSG as though current-info polling is actively maintaining the server's state model today.

### 3. Template support is not proof of production support

`client-template` is useful for understanding intended protocol shape.
It is not strong evidence that a feature is fully implemented in the real client(s) used in practice.

That matters especially for:

- `AddPromot`
- `CreateNewSession`
- `SetClientDisplaySession`
- `GetSessionMsg`

### 4. Bridge packages may rely on optimistic assumptions

The Feishu bridge README already assumes certain OSG session operations exist and behave well enough to bridge chat traffic.
That may be directionally correct, but it is not the same as having a validated end-to-end contract.

Maintainers should document where a bridge depends on a capability that is:

- protocol-defined,
- server-routed,
- but not yet deeply validated in a real client implementation.

## Practical Maintenance Rule

When someone says "OSG supports X", rewrite that mentally into three checks:

1. protocol defines X,
2. server routes/consumes X,
3. at least one real client reliably implements X.

Only after all three are true should docs present X as a stable end-to-end capability.

## Suggested Next Validation Targets

If continuing OSG maintenance, the most useful next checks are:

1. identify the real client implementation(s) actually used with this server,
2. verify whether `ClientContentExecuteing` is sent on connect, session switch, and workspace switch,
3. verify whether `AddPromot` and `GetSessionMsg` are truly functional end-to-end,
4. document any gap between template behavior and production behavior.
