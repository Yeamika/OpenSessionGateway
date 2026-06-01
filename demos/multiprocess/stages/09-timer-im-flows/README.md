# Stage 09: Timer + IM Flows

## Purpose

Verify that timer and IM endpoints produce correct OSGP wire envelopes and
deliver them through the router to target sessions via canonical paths.

## Scope

- **Timer endpoint**: timer fires → `control/add_prompt` envelope → router → target session
- **IM endpoint**: inbound IM message → `control/add_prompt` → target session
- **IM endpoint**: read messages → `request/runtime_session_messages` → target runtime → `response`

## What this stage does NOT cover

- ForwardEngine rule-driven mirror/fanout (Stage 10)
- Full matrix evidence collection (Stage 11)

## Prerequisites

- Stage 00 (build) — binaries compiled
- Stage 01 (router boot) — root/east/west/nested routers running
- Stage 02 (clientdummy announce) — alpha/beta/gamma/omega sessions announced
- Stage 03 (endpoint boot) — timer-endpoint and im-endpoint running

## Verification targets

### 1. Timer → control/add_prompt

The timer endpoint (`endpoints/timer/`) sends a `control/add_prompt` envelope
when a timer fires. Wire format (from `osgp_wire::create_timer_trigger_envelope`):

```json
{
  "type": "envelope",
  "linkType": "control",
  "subtype": "add_prompt",
  "source": { "domain": "domain-a", "runtime": "timer-endpoint", "session": "timer" },
  "target": { "domain": "...", "runtime": "...", "session": "..." },
  "payload": {
    "timer": { "timer_id": "...", "timer_type": "OneShot", ... },
    "prompt": { "msg": "[OSG-Timer-Triggered]", "system": "..." }
  },
  "ttl": 32
}
```

**Verify**: router log shows `control/add_prompt` received from timer-endpoint
address, forwarded to target session's runtime.

### 2. IM → control/add_prompt

The IM endpoint (`endpoints/im/`) sends `control/add_prompt` via
`gv::send_add_prompt()` when forwarding an inbound IM message:

```json
{
  "linkType": "control",
  "subtype": "add_prompt",
  "payload": { "text": "...", "role": "user", "system": "..." }
}
```

**Verify**: router log shows `control/add_prompt` from im-endpoint address.

### 3. IM → request/runtime_session_messages

The IM endpoint sends `request/runtime_session_messages` via
`gv::send_read_messages()` to read session history:

```json
{
  "linkType": "request",
  "subtype": "runtime_session_messages",
  "payload": { "sessionId": "...", "limit": 20 }
}
```

**Verify**: router log shows `request/runtime_session_messages` from
im-endpoint, followed by `response` from target runtime.

## Evidence collection

Each verification writes a PASS/FAIL line to `$LOG_DIR/09-timer-im-flows.txt`.
Summary counts are appended at the end.

## Script

Run: `bash demos/multiprocess/stages/09-timer-im-flows/verify.sh [LOG_DIR]`
