---
title: Persistence
description: Clarify volatile storage and upkeep
---

Live monitoring state lives in process memory today. Runtime, session, workspace, and display live state are not DB-backed yet.

---

## Note limits

Runtime, session, workspace, and display bundles live in `globalThis` maps. Plugin host storage also uses in-memory `Map` storage and is lost on server restart.

---

## Describe files

`OSG_SERVER_RUNTIME_DIR` currently backs server port lock files under `.runtime/locks/`. It is not the source of truth for live runtime and session state.

---

## Guide restarts

On disconnect, only the WS queue is cleaned while cached live bundles remain and the runtime becomes `offline`. After a server restart, that in-memory state is rebuilt from fresh connections.

---

## Keep aligned

When live-state semantics change, update this file with the model and dataflow notes in the same patch. Treat mailbox or handoff updates as prompts to re-check the code path before editing docs.
