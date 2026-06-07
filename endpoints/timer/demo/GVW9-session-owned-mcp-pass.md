# GVW9 Timer session-owned MCP demo PASS record

Date: 2026-06-02 UTC

## Conclusion

**PASS**

The GVW9 Timer session-owned MCP demo was retested successfully. The target
opencode session created a one-shot timer through the `timer_scheduler` MCP
surface. The test did **not** manually specify or forge `ExecutorSessionID`.
When the timer fired, the same session received the timer-triggered prompt and
replied with `GV_TIMER_OK`. A later idle-window check confirmed that the
one-shot timer did not fire a second time and that the Timer endpoint had no
pending timers.

## Test target and acceptance criteria

Target: validate the Timer endpoint demo from the point of view of the creating
opencode session.

Acceptance criteria:

1. The timer is created by the target opencode session itself through MCP.
2. `ExecutorSessionID` is provided by opencode execution context, not by the
   prompt, operator, script, or test harness.
3. The stored timer owner/target matches the creating session.
4. At `trigger_at`, Timer sends canonical `control/add_prompt` to the same
   target session.
5. The target session replies exactly `GV_TIMER_OK`.
6. The one-shot timer is removed after firing and does not duplicate.

## Environment and components

| Component | Value |
|---|---|
| Container | `osg-test-2` |
| Workspace | `/workspace/OSG-Project` |
| Demo workdir | `/workspace/OSG-Project/.tmp/gv-timer-work4` |
| Router binary | `/workspace/OSG-Project/.tmp/gv-retest-bin-ses_18185e651ffe/router` |
| Router bind | `127.0.0.1:7305` |
| Timer endpoint binary | `/tmp/timer-endpoint` |
| Timer endpoint HTTP/MCP | `127.0.0.1:8792` |
| opencode serve | `127.0.0.1:9545` |
| opencode runtime / `VEIN_RUNTIME_ID` | `gv_timer_addr` |
| Timer endpoint runtime/session | `timer-endpoint` / `timer` |
| opencode plugin | `file:///workspace/OSG-Project/.tmp/gv-plugin-verify-ses_18185e651ffe/plugin` |
| MCP URL | `http://127.0.0.1:8792/mcp/timer_scheduler?runtimeID=gv_timer_addr` |
| Successful TUI model | `openai/gpt-5.5` |
| opencode version shown in TUI | `0.0.0-local-yes-2606020238` |

Note: an earlier TUI attempt with `gpt-5.4-mini` reached the TUI path but failed
because the provider returned `model_not_found`; the successful run used the
same TUI/MCP path with `openai/gpt-5.5`.

## Key evidence

Successful opencode session:

```text
ses_1796310d8ffef1oIMYqFU1rerC
```

Timer ID:

```text
timer-a06e5b85-c217-4866-b880-9e67c769493f
```

Actual MCP tool call:

```text
timer_scheduler_CreateOneShotTimer
```

Actual tool input observed from the opencode session export:

```json
{
  "ExecutorRuntimeID": "",
  "afterSeconds": 10,
  "msg": "Reply GV_TIMER_OK only.",
  "title": "GVW9 address-fixed self-owned one-shot auto-session TUI"
}
```

Important ownership note:

- The input contains **no** `ExecutorSessionID` field.
- `ExecutorSessionID` was therefore not supplied by the test prompt, operator,
  script, or harness.
- The Timer endpoint contract still requires `ExecutorSessionID`; in this demo
  it was supplied by opencode/MCP runtime context before the endpoint handled
  the call.
- `ExecutorRuntimeID` was present as an empty string in the tool input; runtime
  resolution used the MCP URL/context and returned `gv_timer_addr`.

Actual tool output observed from the opencode session export:

```json
{
  "ok": true,
  "runtime_id": "gv_timer_addr",
  "session_id": "ses_1796310d8ffef1oIMYqFU1rerC",
  "status": "pending",
  "timer_id": "timer-a06e5b85-c217-4866-b880-9e67c769493f",
  "timer_type": "one_shot",
  "trigger_at": "2026-06-02T04:35:06.930Z"
}
```

Timer-triggered prompt and reply in the same session export:

```text
user:      Reply GV_TIMER_OK only.
assistant: GV_TIMER_OK
```

Idle-window repeat check:

```text
Reply GV_TIMER_OK only. user prompts: 1
GV_TIMER_OK assistant replies:        1
message count:                        5
```

Timer endpoint status after idle-window verification:

```json
{
  "domain": "opencode",
  "gv_connection": "Connected",
  "ok": true,
  "pending_timers": 0,
  "runtime_id": "timer-endpoint",
  "session_id": "timer"
}
```

## UTC timeline

| UTC time | Event | Evidence |
|---|---|---|
| 2026-06-02T04:34:52.378Z | TUI session submitted the timer creation request | user message in `ses_1796310d8ffef1oIMYqFU1rerC` |
| 2026-06-02T04:34:56.928Z | `timer_scheduler_CreateOneShotTimer` started | tool part `time.start` |
| 2026-06-02T04:34:56.932Z | tool call completed | output returned `ok=true`, `timer_id=timer-a06e5b85-c217-4866-b880-9e67c769493f` |
| 2026-06-02T04:35:05.569Z | assistant reported `TIMER_CREATED_AUTO_TUI` and echoed actual input/output | assistant message completed |
| 2026-06-02T04:35:06.930Z | scheduled trigger time | `trigger_at` in tool output |
| 2026-06-02T04:35:07.271Z | same session received timer prompt | user message `Reply GV_TIMER_OK only.` |
| 2026-06-02T04:35:08.992Z | same session replied `GV_TIMER_OK` | assistant message completed |
| 2026-06-02T04:37:54Z and later | idle-window repeat check | prompt/reply counts each equal 1; `pending_timers=0` |

## Mermaid sequence

```mermaid
sequenceDiagram
    participant TUI as opencode TUI session<br/>ses_1796310d8ffef1oIMYqFU1rerC
    participant MCP as timer_scheduler MCP<br/>runtimeID=gv_timer_addr
    participant Timer as timer-endpoint<br/>opencode/timer-endpoint/timer
    participant Router as GlassVein router
    participant Plugin as opencode plugin<br/>gv_timer_addr

    TUI->>MCP: CreateOneShotTimer(msg, afterSeconds=10, title)<br/>no ExecutorSessionID in input
    MCP->>Timer: create owner from opencode context / MCP URL
    Timer-->>TUI: ok, runtime_id=gv_timer_addr,<br/>session_id=ses_1796310d8ffef1oIMYqFU1rerC,<br/>timer_id=timer-a06e5b85...
    Timer->>Router: fire canonical control/add_prompt<br/>source=opencode/timer-endpoint/timer<br/>target=opencode/gv_timer_addr/ses_1796310d8ffef1oIMYqFU1rerC
    Router->>Plugin: deliver add_prompt
    Plugin->>TUI: add user prompt<br/>Reply GV_TIMER_OK only.
    TUI-->>Plugin: assistant reply GV_TIMER_OK
    Timer-->>Timer: one-shot removed; pending_timers=0
```

## Installation and startup process

1. Verified `/tmp/timer-endpoint` was available and executable in `osg-test-2`.
2. Started the GlassVein router on `127.0.0.1:7305` with the retest router binary.
3. Temporarily configured opencode runtime MCP:

   ```text
   timer_scheduler -> http://127.0.0.1:8792/mcp/timer_scheduler?runtimeID=gv_timer_addr
   ```

4. Started opencode serve with:

   ```sh
   GV_ROUTER_URL=ws://127.0.0.1:7305 \
   VEIN_RUNTIME_ID=gv_timer_addr \
   opencode serve --hostname 127.0.0.1 --port 9545 --print-logs --log-level DEBUG
   ```

5. Started Timer endpoint with a config targeting `gv_timer_addr` and Timer
   endpoint identity `timer-endpoint/timer`.
6. Opened opencode interactive TUI via `opencode attach` and used the TUI path to
   submit the MCP creation request.

The Python PTY harness used in the successful run only provided terminal/keyboard
I/O for the interactive TUI and did not create the timer through Timer REST,
opencode HTTP session APIs, `opencode run`, console, or operator-side MCP.

## Verification flow

1. Opened opencode TUI attached to the running opencode server.
2. Submitted a prompt asking the session to call
   `timer_scheduler_CreateOneShotTimer` with:
   - `msg="Reply GV_TIMER_OK only."`
   - `afterSeconds=10`
   - `title="GVW9 address-fixed self-owned one-shot auto-session TUI"`
3. Explicitly instructed the TUI session not to include `ExecutorSessionID` or
   `ExecutorRuntimeID`.
4. Exported the successful session transcript and recorded actual tool input and
   output.
5. Confirmed the tool output owner/target session matched the creating session:
   `ses_1796310d8ffef1oIMYqFU1rerC`.
6. Waited through `trigger_at` and confirmed the same session received the
   timer-triggered prompt.
7. Confirmed the same session replied `GV_TIMER_OK`.
8. Waited an additional idle window and confirmed:
   - exactly one timer prompt,
   - exactly one `GV_TIMER_OK` reply,
   - `pending_timers=0`.

## Cleanup

Cleanup was completed after verification:

- Stopped the test opencode serve process on `127.0.0.1:9545`.
- Stopped the test router on `127.0.0.1:7305`.
- Stopped the Timer endpoint on `127.0.0.1:8792`.
- Killed orphan `opencode attach` TUI processes created during terminal/TUI
  compatibility attempts.
- Restored the runtime opencode config to its pre-test backup:
  - original `nextcloud` MCP only,
  - original plugin list.
- Verified no residual test processes matching `7305`, `9545`, `8792`,
  `gv_timer_addr`, or `gv-timer-addr` remained.

No git commit was made for this record.

## Notes and caveats

- `ExecutorSessionID` must be supplied by opencode tool execution context and
  must not be manually specified or forged by the model, script, operator, or
  test harness.
- This PASS record is based on the successful TUI-created session
  `ses_1796310d8ffef1oIMYqFU1rerC`.
- The final evidence does not rely on earlier failed attempts that used invalid
  models or previously unfinished sessions.
