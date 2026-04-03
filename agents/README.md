# Agent Workspaces

This directory isolates agent workspaces from the product code roots.

Each subfolder defines one maintenance surface and points back to the real code it owns.
Keep product code in the normal code roots; keep agent-local runtime, wrappers, notes, and non-code support assets here.

Shared dependency rule:

- Install once at the repo root and reuse the shared root `node_modules/`.
- Start runtime/build/lint/dev flows from these agent folders.

Current agent layout:

```text
agents/
  web/
  server/
  opencode-plug/
  serverplug-im/
  serverplug-core/
  opencode-dev/
  opencode-test/
  opencode-release/
  opencode-global/
```

Ownership map:

- `web/` -> `web/`
- `server/` -> `server/`
- `opencode-plug/` -> `packages/client-opencode-plugin-v2/`, `packages/client-library/`
- `serverplug-im/` -> `plugins/IM-gateway/`
- `serverplug-core/` -> `plugins/runtime-control/`, `plugins/session-bridge/`, `plugins/timer-scheduler/`, `packages/server-plugin-sdk/`
- `opencode-dev/` -> `D:\ai\OPENCODE_AUTO\Yaemio\opencode\packages\opencode\`
- `opencode-test/` -> `D:\ai\OPENCODE_AUTO\Yaemio\opencode\packages\opencode\`
- `opencode-release/` -> `D:\ai\OPENCODE_AUTO\Yaemio\opencode\`, `.github/workflows/`, packaging and publish scripts

Non-code map:

- `agents/server/.runtime/` -> gateway locks, logs, heap dumps, and runtime support files used by generic server work
- `agents/server/.archive/` -> historical server backups
- `agents/opencode-plug/.runtime/` -> OpenCode runtime logs and client-template fleet workspaces
- `agents/serverplug-im/.runtime/` -> IM gateway state and IM gateway workspaces
- `agents/serverplug-im/vendor/` -> third-party IM adapter source snapshots and tarballs
- `agents/serverplug-core/.runtime/` -> focused gateway runtime area for core plugin work
- `agents/opencode-global/.opencode/` -> shared OpenCode plugin and custom agent definitions used by attached TUI sessions
