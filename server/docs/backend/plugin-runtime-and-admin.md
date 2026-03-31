---
title: Plugin runtime
description: Explain autoload, admin APIs, and IM bridge status
---

Server plugins are loaded dynamically. Startup autoload, local admin actions, and runtime hooks all work without restarting the main OSG server.

---

## Run autoload first

Main server startup calls `ensureAutoloadPluginsLoaded()` in `server.ts` before the HTTP and websocket listeners are ready. The local plugin admin server also ensures autoload state before serving requests.

---

## Operate plugins live

The local plugin admin server listens on `127.0.0.1:4091` by default. Use it to load, unload, or reload package-style server plugins while the main OSG server keeps running.

---

## List admin APIs

- `GET http://127.0.0.1:4091/api/plugins`
- `POST http://127.0.0.1:4091/api/plugins/load`
- `POST http://127.0.0.1:4091/api/plugins/unload`
- `POST http://127.0.0.1:4091/api/plugins/reload`
- `POST http://127.0.0.1:4091/api/plugins/autoload`
- `POST http://127.0.0.1:4091/api/plugins/autoload/apply`

`/api/plugins/autoload` updates saved autoload state and immediately loads or unloads that package when possible. `/api/plugins/autoload/apply` reapplies the saved autoload config across the allowed roots.

---

## Explain loading model

Plugins are discovered from configured plugin roots and loaded into `worker_threads`. `reload` is implemented as `unload` followed by `load` from the same file source.

---

## Describe autoload filters

Autoload supports root-level `allow` and `deny` filters, plus per-package opt-out. Env allow entries take precedence over file allow lists, while env and file deny entries are both applied.

---

## Note IM bridge status

`IM-bridge` remains dynamically managed through the same plugin runtime. Its direct `feishu` provider now supports official Feishu websocket realtime inbound, while webhook handling and the bridge polling path remain available.
