---
title: State model
description: Map live bundles and activity fields
---

OpenSessionGateway keeps live runtime data in memory. Runtime, session, workspace, and display bundles are linked by `runtimeID`.

---

## Define bundles

A runtime bundle stores `wsBridge` plus the current workspace, session, and display bundles for that runtime. The registries stay separate in memory and are hydrated together when the runtime view is read.

---

## Describe status

Runtime `status` is currently only `online` or `offline`. `sessionStatus` is separate and may be `idle`, `busy`, `error`, or `null`.

---

## Explain disconnect

When a socket disconnects, the server rejects pending WS requests, removes the old queue, fires `runtime_disconnect`, and marks `wsBridge.connected = false`. It does not clear cached runtime, session, workspace, or display bundles unless `removeRuntimeBundle()` is called explicitly.

---

## Explain activity

Session activity is primarily tracked through `CLIENT_CONTENT_EXECUTEING`. Each event updates `lastActiveTime`, increments `activeCount`, and refreshes the tracked `displayID`, `title`, and session `status`.

---

## Note visibility

Offline runtimes can still appear in live lists because cached bundles remain in memory after disconnect. If a runtime already has tracked sessions, those cached sessions are listed too.
