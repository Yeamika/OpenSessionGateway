---
title: Plugin runtime
description: Explain autoload, admin APIs, and IM gateway status
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

Plugins are discovered from configured plugin roots. File-loaded plugin packages run in `worker_threads`, while builtin in-process plugins are also supported by the host API. `reload` is implemented as `unload` followed by `load` from the same file source.

---

## Describe autoload filters

Autoload supports root-level `allow` and `deny` filters, plus per-package opt-out. Env allow entries take precedence over file allow lists, while env and file deny entries are both applied.

---

## Note IM gateway status

The current repo IM plugin is `IM-gateway`, and its package opts out of startup autoload by default. When loaded, it starts its own local IM HTTP server on `127.0.0.1:4092` by default, registers `im_gateway_control` and `im_gateway_chat`, and its builtin `feishu` provider supports official Feishu websocket realtime inbound, webhook handling, and provider polling fallback.
