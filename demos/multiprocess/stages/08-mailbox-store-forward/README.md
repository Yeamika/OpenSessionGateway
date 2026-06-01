# Stage 08 — Mailbox Store-Forward

Verify mailbox deliver and reminder flows using canonical `control/add_prompt`.
No new mailbox subtypes are introduced; all OSGP wire messages use the existing
canonical registry.

## Prerequisites

- Stage 01 (router-boot): root/east/west/nested routers running.
- Stage 02 (clientdummy-announce): alpha-client connected to east-router with
  `session-alpha-1`.
- Stage 03 (endpoint-boot): mailbox-endpoint connected to west-router.

## Topology

```
east-router :7201
├─ alpha-client (runtime-alpha, session-alpha-1)
│  └─ receives: control/add_prompt from mailbox-endpoint
└─ ...

west-router :7202
├─ mailbox-endpoint (mailbox-rt, mailbox)
│  └─ stores, delivers, reminds via control/add_prompt
└─ ...
```

Address map:

| Node | Domain | Runtime | Session | Router |
|------|--------|---------|---------|--------|
| alpha-client | east | runtime-alpha | session-alpha-1 | east-router :7201 |
| mailbox-endpoint | domain-a | mailbox-endpoint | mailbox | west-router :7202 |

## Key Design Points

### No new mailbox subtypes

Mailbox operations are local MCP tool calls, NOT OSGP wire subtypes:

| Operation | Local MCP tool | OSGP wire (if any) |
|-----------|---------------|-------------------|
| Store a mail | `SendMailboxItem` | (local only) |
| List mails | `ListMailboxItems` | (local only) |
| Read a mail | `ReadMailboxItem` | (local only) |
| Reply to mail | `ReplyMailboxItem` | (local only) |
| Delete a mail | `DeleteMailboxItem` | (local only) |
| Get reminders | `MailboxReminders` | (local only) |
| **Deliver reminder** | (internal) | `control/add_prompt` |
| **Receive delivery** | (endpoint handler) | `control/add_prompt` |

Outbound reminders use canonical `control/add_prompt` — the same subtype used
by console, timer, and IM endpoints. No `mailbox.reminder`, `MailboxReminders`,
`need_replay`, or other dynamic subtypes are used on the wire.

### Store-Forward Model

1. **Store**: External caller sends `SendMailboxItem` to mailbox-endpoint MCP.
   The mail is stored in the mailbox-endpoint's in-memory store, keyed by
   target `(runtimeID, sessionID)`.

2. **Forward (Deliver)**: When the target session's runtime is connected and
   the mailbox has undelivered items, the mailbox-endpoint constructs a
   `control/add_prompt` envelope targeting the session's address and sends it
   via the router. The payload contains the mail content.

3. **Reminder**: For `NeedReplay` type items that remain unread, the
   `MailboxReminders` MCP tool returns them. The endpoint may also send
   periodic `control/add_prompt` reminders to the target session.

## Scenarios

### S08-1: Deliver — SendMailboxItem → control/add_prompt

| Step | Action | Detail |
|------|--------|--------|
| 1 | `SendMailboxItem` | title="test-deliver", msg="hello from mailbox", type="Notice", runtimeID="runtime-alpha", sessionID="session-alpha-1" |
| 2 | Verify store | `ListMailboxItems` for target shows new item |
| 3 | Verify delivery | Mailbox-endpoint sends `control/add_prompt` to east/runtime-alpha/session-alpha-1 |
| 4 | Verify receipt | alpha-client handler logs the control envelope |

**Expected evidence**:
- `ListMailboxItems` returns item with title="test-deliver"
- alpha-client logs show received `control/add_prompt` with mail content

### S08-2: Reminder — NeedReplay + MailboxReminders

| Step | Action | Detail |
|------|--------|--------|
| 1 | `SendMailboxItem` | title="test-reminder", msg="please reply", type="NeedReplay", runtimeID="runtime-alpha", sessionID="session-alpha-1" |
| 2 | Verify store | `ListMailboxItems` shows NeedReplay item |
| 3 | Query reminders | `MailboxReminders` returns unread NeedReplay items |
| 4 | Verify reminder delivery | Mailbox-endpoint sends `control/add_prompt` reminder |

**Expected evidence**:
- `MailboxReminders` returns item with title="test-reminder"
- `control/add_prompt` envelope is sent to target session

### S08-3: Store without delivery (offline target)

| Step | Action | Detail |
|------|--------|--------|
| 1 | `SendMailboxItem` | title="offline-mail", msg="stored for later", type="Notice", runtimeID="runtime-offline", sessionID="session-offline" |
| 2 | Verify store | `ListMailboxItems` for offline target shows item |
| 3 | Verify no crash | Mailbox-endpoint remains healthy |

**Expected evidence**:
- Item stored successfully
- No panic or error in mailbox-endpoint logs
- Item available for future delivery when target comes online

### S08-4: Reply flow

| Step | Action | Detail |
|------|--------|--------|
| 1 | `SendMailboxItem` (NeedReplay) | title="reply-test", msg="question?", type="NeedReplay" |
| 2 | `ReplyMailboxItem` | reply with replayID from step 1 |
| 3 | Verify | Original item status updated, reply item created |

**Expected evidence**:
- Original item shows replied status
- New reply item exists in store

## Script

`run.sh` is a bounded smoke script:

1. Assumes routers + alpha-client are already running (from stages 01–02).
2. Starts mailbox-endpoint with `configs/mailbox-west.json`.
3. Waits for HTTP readiness.
4. Executes S08-1 through S08-4 via MCP API calls.
5. Verifies each scenario via API queries and log inspection.
6. Prints summary.
7. Cleans up mailbox-endpoint process.

All processes are killed on exit via trap. Timeout: 60 seconds.

## Evidence file

Output goes to `.tmp/stage-08-evidence.json` with:

```json
{
  "stage": "08-mailbox-store-forward",
  "timestamp": "ISO-8601",
  "scenarios": [
    { "id": "S08-1", "name": "deliver", "status": "pass|fail", "detail": "..." },
    { "id": "S08-2", "name": "reminder", "status": "pass|fail", "detail": "..." },
    { "id": "S08-3", "name": "offline_store", "status": "pass|fail", "detail": "..." },
    { "id": "S08-4", "name": "reply_flow", "status": "pass|fail", "detail": "..." }
  ],
  "overall": "pass|fail"
}
```

## Requirements declared (not implemented here)

These are declared requirements for the mailbox-endpoint behavior that this
stage validates. The actual implementation is in `endpoints/mailbox/`:

1. **Store**: `SendMailboxItem` stores item keyed by `(runtimeID, sessionID)`.
2. **Deliver**: When target is reachable, send `control/add_prompt` with mail payload.
3. **Reminder**: `MailboxReminders` returns unread `NeedReplay` items.
4. **Offline resilience**: Store works even when target is unreachable.
5. **Reply**: `ReplyMailboxItem` updates original and creates reply.
6. **No new subtypes**: All wire messages use `control/add_prompt` only.

## Non-goals

- Does NOT modify router rules, manual routes, or state-files.
- Does NOT start routers (assumes Stage 01).
- Does NOT add new mailbox OSGP subtypes.
- Does NOT test flow-rule fanout (Stage 10).
