---
title: Dataflow
description: Show connect, events, and live sorting
---

The live view is built from the active WS queue plus cached runtime bundles. Connect, event, and list paths all flow through the same `runtimeID`.

---

## Follow connect

A new runtime connection creates a queue, updates the runtime WS bridge, emits `runtime_connect`, and then sends the `connected` ack. Duplicate live connections for the same `runtimeID` are rejected, while inactive old queues are cleaned before a replacement connects.

---

## Track events

Every remembered WS event updates `lastActiveAt` on the queue and touches runtime `lastSeenAt`. The queue also caches `lastClientContentExecuteing` and `lastSessionList`. `CLIENT_CONTENT_EXECUTEING` is the main session activity source.

---

## Describe rows

If a runtime has tracked sessions, the live list emits one row per session. Online rows reuse the queue's latest `instanceWorkspaceDirectory` snapshot. Offline runtimes can still appear from cached bundles, but their `instanceWorkspaceDirectory` field may be empty because the queue is gone.

---

## Describe ordering

Runtime rows sort `online` before `offline`. After that, higher `activeCount` and newer `lastActiveTime` win before tie-breakers like `updatedAt`, `runtimeID`, `instanceWorkspaceDirectory`, `displayID`, `title`, and `sessionID`.

---

## Sort sessions

Session bundles sort by `activeCount`, then `lastActiveTime`, then `status`, `title`, and `sessionID`. This keeps busier sessions near the top even after reconnects.
