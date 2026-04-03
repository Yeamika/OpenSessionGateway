# OSG Persistence and Mailbox Notes

## Current persistence picture

The current OSG hot path uses several different storage layers, but they do not play the same role.

## What is verified today

### Redis

Redis is an active runtime dependency.
Current server code uses it for:

- health checks
- pager log storage

### In-memory live state

The main live runtime graph is process-local memory, including:

- runtime bundles
- session bundles
- instance-workspace bundles
- display bundles
- permission records
- WS queue state

This is the source of truth for current live monitoring behavior.

### Plugin storage

Plugin storage is also process-local memory managed by the plugin host.
It is used by features such as:

- mailbox state in `session-bridge`
- timer buckets in `timer-scheduler`

It is not DB-backed.

### IM gateway state

`IM-gateway` keeps its own file-backed JSON state through `StateStore(config.stateFilePath)`.
That covers accounts, session bindings, routes, uploads, assets, and recent route data.
This is separate from plugin-host in-memory storage.

### Prisma and PostgreSQL

Prisma client and schema files are present in the repo, but current server runtime paths do not use them as the live runtime-state store.
Docs should not describe the current runtime and session graph as DB-backed.

## Mailbox storage

Mailbox state lives in `session-bridge` plugin storage, not in session bundles.

Current key shapes include:

- `mailbox:session:${sessionID}`
- `mailbox:reminder:${runtimeID}::${sessionID}`

Mailbox item types still include:

- `Notice`
- `NeedReplay`
- `QuestReply`
- `Replaied`

## Mailbox reminder behavior

Mailbox reminders do more than show unread counts.
The plugin can:

- inspect unread and unreplied rows,
- schedule reminder timers,
- send a synthetic mailbox reminder back into the target session through `osg.addPrompt()`,
- optionally show a toast.

That reminder path does not mutate session bundles directly. It uses plugin storage plus the normal session-input path.

## Maintenance implications

The key operational distinction is this:

- disconnect may keep cached live bundles,
- full server restart drops the in-memory runtime graph and plugin storage,
- docs should distinguish durable files and config from live state.
