# OSG Runtime, Session, Instance Workspace, and Display Model

## Overview

The current OSG live model revolves around four related objects:

- runtime
- session
- instance workspace
- display

They are tracked in separate registries and linked together through `runtimeID`.

## Runtime

Runtime is the top-level connected execution identity.
The runtime bundle is keyed by `runtimeID` and stores the live WS bridge state for that runtime.

Important runtime behavior:

- `runtimeID` is the root routing key
- disconnect marks the runtime `offline`
- disconnect does not automatically clear cached session, instance-workspace, or display bundles
- explicit `removeRuntimeBundle()` is the path that clears those child bundles

## Session

Session bundles are keyed by `runtimeID::sessionID`.
They currently track:

- `displayID`
- `title`
- `status`
- `lastActiveTime`
- `activeCount`

Session activity is mainly learned from `ClientContentExecuteing`.
There is no first-class session-to-workspace field on the session bundle today.

## Instance workspace

Instance-workspace bundles are keyed by `runtimeID::instanceWorkspaceDirectory`.
They store:

- `instanceWorkspaceDirectory`
- `title`
- MCP caller-binding state

The current WS event handler writes the directory as the title, so title often mirrors the directory path.

## Display

Display bundles are keyed by `runtimeID::displayID`.
They are tracked separately from sessions and instance workspaces and are updated from runtime activity events.

## How associations are learned

`ClientContentExecuteing` is the main learning path for live associations.
When the server receives it, it can:

- ensure the instance-workspace bundle exists,
- ensure the session bundle exists,
- update the session `displayID`, `title`, `status`, `lastActiveTime`, and `activeCount`,
- ensure the display bundle exists.

The server does not currently persist a direct session-to-instance-workspace pointer in the session bundle.
That association is inferred from recent runtime activity instead.

## Operational meaning

For maintainers, the practical model is:

- runtime is the routing anchor,
- session is the active execution unit,
- instance workspace is the reported directory context,
- display is the runtime-side UI slot,
- the whole live graph is mostly process-local and must be rebuilt after restart.
