# Timer Endpoint Demo

This demo validates the Timer endpoint from the point of view of one target
session. The timer must be created by the session itself through the Timer MCP
surface; the test driver must not create the timer on behalf of the session.

## Scope

- Target session creates a one-shot timer through MCP.
- Timer endpoint stores the timer for that same runtime/session bucket.
- When the timer fires, Timer sends canonical `control/add_prompt` back to the
  same target session.
- The target session becomes busy, replies with the expected token, then returns
  to idle/completed.
- A one-shot timer must not fire twice.

Out of scope for this demo:

- Router topology validation.
- Console observation validation.
- Timer web UI validation.
- Periodic and cron timers.

## Required invariants

1. The creation event must originate from the target session via MCP.
2. The stored timer owner/target must match the creating session.
3. The fired business envelope must be canonical `control/add_prompt`.
4. The endpoint must not send `timer.fired`, `timer.response`, or any other
   Timer-specific subtype.
5. The timer endpoint must not modify router routes, rules, or state files.

## Minimal sequence

| Step | Actor | Expected evidence |
|---|---|---|
| T0 | Target session | User asks the session to create a one-shot timer through MCP. |
| T1 | Target session → Timer MCP | MCP call, for example `CreateOneShotTimer(afterSeconds=10, msg="Reply GV_TIMER_OK only.")`. |
| T2 | Timer endpoint | Timer queued with `timer_id`, `due_at`, and owner/target equal to the creating session. |
| T3 | Timer endpoint | No `control/add_prompt` is emitted before `due_at`. |
| T4 | Timer endpoint | At `due_at`, timer fires exactly once. |
| T5 | Timer endpoint → Target session | Sends canonical `control/add_prompt` with Timer metadata in payload. |
| T6 | Target session | Session state becomes `busy`. |
| T7 | Target session | Assistant replies with the expected token, e.g. `GV_TIMER_OK`. |
| T8 | Target session | Session state becomes `idle`, `reason=completed`. |
| T9 | Timer endpoint | After an additional wait window, no duplicate fire is observed. |

## Expected timing table format

Use UTC timestamps in the final acceptance report.

| Stage | Time (UTC) | Evidence |
|---|---:|---|
| create timer via MCP | `<T0>` | target session issued `CreateOneShotTimer`; caller session id = target session id |
| timer queued | `<T0 + small Δ>` | `timer_id=...`, `due_at=...`, `target=<runtime/session>` |
| due wait window | `<T0..due_at>` | no add_prompt emitted before due time |
| timer fired | `<due_at>` | timer log shows one-shot fired once |
| add_prompt sent | `<due_at + Δ>` | outbound OSGP `control/add_prompt` to target session |
| session busy | `<due_at + Δ>` | target session state update: `busy` |
| session reply | `<due_at + Δ>` | assistant message equals expected token, e.g. `GV_TIMER_OK` |
| session idle | `<due_at + Δ>` | target session state update: `idle`, `reason=completed` |
| no duplicate | `<idle + wait>` | no second fire / no second add_prompt for same `timer_id` |

## Mermaid sequence

```mermaid
sequenceDiagram
    participant Session as target session
    participant Timer as timer-endpoint

    Session->>Timer: MCP CreateOneShotTimer(afterSeconds, msg)
    Timer->>Timer: store timer(timer_id, due_at, owner=Session, target=Session)
    Note over Timer: wait until due_at; no add_prompt before due_at
    Timer->>Session: control/add_prompt (timer metadata + prompt)
    Session->>Session: state=busy
    Session->>Session: assistant replies GV_TIMER_OK
    Session->>Session: state=idle completed
    Note over Timer,Session: wait window confirms one-shot did not duplicate
```

## Acceptance wording

Report `PASS` only if the evidence proves all of the following:

- The target session itself created the timer through MCP.
- The timer fired after its due time.
- The fired message was canonical `control/add_prompt`.
- The target session replied with the expected token.
- The target session returned to idle/completed.
- No duplicate fire occurred for the same one-shot timer.

If the timer is created by the test harness, console, operator, or any session
other than the target session, report `FAIL` for this demo even if the final
add_prompt reaches the target session.
