# OSG Runtime, Session, and Workspace Model

## Overview

The current OSG implementation uses three core domain objects:

- runtime
- session
- workspace

These are tracked separately but linked together through server-side registries.

## Runtime

Runtime is the top-level connected execution identity.
A runtime bundle is created and stored in a global in-memory registry keyed by `runtimeID`.

Current runtime-related responsibilities include:

- WebSocket bridge connectivity state,
- identity and host tracking,
- caller-to-runtime binding,
- coordination with session and workspace registries.

When a runtime is removed, associated sessions and workspaces are also cleared.

## Session

Sessions are stored in a separate global in-memory registry keyed by:

`runtimeID::sessionID`

This means session identity is runtime-scoped in the registry layer, even if some search helpers can look up by bare `sessionID`.

Current session registry behavior includes:

- create-on-demand bundle creation,
- listing all sessions for a runtime,
- listing sessions under a workspace,
- locating a session bundle by `sessionID`,
- clearing all sessions for a disconnected runtime.

This strongly suggests that a session belongs to exactly one runtime at a time.

## Workspace

Workspaces are stored in another global in-memory registry keyed by:

`runtimeID::workspaceID`

A workspace can carry:

- runtime association,
- directory,
- title,
- MCP-related caller bindings.

The workspace registry also keeps a caller-key-to-runtime map used during MCP session bridge flows.

This is an important implementation detail: caller affinity is not just an auth concept; it is part of how runtime routing is remembered.

## Relationship Between the Three

The current model appears to be:

- a runtime owns many sessions,
- a runtime owns many workspaces,
- a session may be associated with a workspace,
- workspace association can be inferred or hydrated from runtime-reported execution context.

In practice, OSG is using runtime as the root container for both session and workspace state.

## How Associations Are Learned

One important path is the `ClientContentExecuteing` WebSocket event.
When the server receives this event, it reads payload data such as:

- workspace path
- session ID
- session title
- display ID

From there, the server:

- ensures or finds a workspace bundle,
- ensures the session bundle exists,
- associates the session with the workspace when possible.

This means some of OSG's state model is not preconfigured. It is learned dynamically from runtime-originated events.

## Operational Meaning

For maintainers, the practical interpretation is:

- runtime is the routing anchor,
- session is the active conversation/execution unit,
- workspace is the environment context,
- registries are currently in-memory and lifecycle-bound to the server process.

That last point matters. The current model is coordination-friendly, but also implies volatility unless additional persistence layers exist elsewhere in the system.
