# OSG OpenCode Plugin Side

## What this covers

This document is about the OSG-facing plugin side inside `packages/client-opencode-plugin-v2/`.
That is the side whose job is to connect an OpenCode environment to OSG as a runtime-capable client.

This is not the same thing as the OSG server, and it is not automatically the same thing as every modified OpenCode fork.

## Intended role

From current repo structure and earlier draft notes, `packages/client-opencode-plugin-v2/` appears to be responsible for:

- creating or configuring an OSG client connection,
- registering a runtime with the OSG server,
- wiring tool or hook integration into the host OpenCode environment,
- reacting to server-originated requests/events,
- and cleaning up on shutdown.

In other words: this package looks like the OSG adapter layer that makes OpenCode participate in the OSG runtime/session model.

## Maintenance questions to ask

When maintaining the plugin side, do not jump straight from protocol definitions to conclusions.
Check all three layers separately:

1. what the protocol library defines,
2. what the OSG server actually routes or expects,
3. what this plugin really sends, handles, and keeps in sync.

## Practical responsibilities

The plugin side should be understood mainly as responsible for:

- **connection lifecycle**: connect, acknowledge, reconnect, shutdown,
- **runtime identity**: `runtimeID`, host naming, and registration expectations,
- **event handling**: whether server-emitted requests such as prompt/session operations are actually implemented,
- **state reporting**: whether it emits enough runtime/session/workspace information for the server to build a useful live model.

## Important maintenance risks

### 1. Treating connection success as runtime readiness

The docs already suggest the client library treats the `connected` ack as the meaningful readiness point.
That distinction matters here too.
A raw WebSocket open is not the same as a successfully registered OSG runtime.

### 2. Assuming template support equals plugin support

`packages/client-template/` is useful for understanding intended protocol shape.
It is not proof that the OpenCode plugin side fully implements the same behaviors.

### 3. Underreporting runtime/session/workspace context

If the plugin side fails to emit the right events or payload fields, the server's live state reconstruction becomes weak or misleading.
That is especially important for events like `ClientContentExecuteing`, which earlier docs already identified as structurally important.

### 4. Blurring plugin logic with host-app logic

Keep a distinction between:

- what belongs to the OSG plugin bridge itself,
- what belongs to the host OpenCode runtime/app,
- and what belongs to server-side coordination.

If those are mixed together in docs or code changes, maintenance gets messy fast.

## What still needs direct validation

This repo's current docs still do not certify:

- which plugin behaviors are truly production-used,
- whether all important server requests are implemented end-to-end,
- how reconnect/session-switch/workspace-switch are reported in real usage,
- how much behavior lives in the plugin versus host OpenCode modifications.

So maintainers should document certainty levels explicitly instead of overselling the integration as more complete than it is.
