# OSG Concepts and Terms

## Runtime

A runtime is a connected execution endpoint registered with OSG.
It is the main top-level identity used by the gateway when managing active connections.

Typical properties observed in code include:

- `runtimeID`
- host information
- connection state
- recent activity timestamps
- associated sessions

## Session

A session is the active interaction or execution context hosted by a runtime.
Session-targeted operations include:

- adding a prompt,
- fetching session messages,
- renaming a session,
- creating a new session,
- changing display session state.

## Workspace

A workspace is a directory or contextual execution scope associated with runtime activity.
The server appears to associate session bundles with workspace bundles when runtime event payloads expose workspace paths.

## Bridge

A bridge is an integration adapter that maps an external system into OSG semantics.
For example, the Feishu bridge maps Feishu chats into runtime/session pairs and translates messages between the two systems.

## Protocol Library

The protocol library is the shared contract package that defines message structures and payload readers/builders used by both client-side and server-side OSG components.

## MCP

Within the current OSG repository, MCP refers to HTTP-exposed control and session-bridge APIs that are used by integrations like the Feishu bridge.
These endpoints provide a tool-call style interface for runtime and session operations.

## Queue

A queue, in the current OSG server code, is the runtime-specific in-memory state object associated with a connected WebSocket client.
It contains more than just a message queue; it also tracks pending requests, event history, and cached summary state.

## Connected Ack

A connected acknowledgment is a server message that confirms an OSG runtime has been accepted by the gateway.
The client library treats this acknowledgment as the actual success condition for connection readiness.

## Current Info

`RequestCurrentInfo` is a WebSocket event used to fetch summary information about the currently connected runtime context.
It is part of the runtime observability path.

## Naming Caution

The current codebase contains some historical or inconsistent spellings, including names such as:

- `AddPromot`
- `ClientContentExecuteing`
- `protocol-library`

These names should be treated carefully in documentation:

- document the real code names accurately,
- explain the intended meaning separately,
- avoid silently “correcting” code identifiers when describing actual implementation behavior.
