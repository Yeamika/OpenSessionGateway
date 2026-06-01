# GlassVein Multiprocess Demo

This folder is the home for the refreshed multi-process demo. It is stage-based:
each stage should be runnable and diagnosable before moving to the next one.

Outputs, logs, and evidence should be written under the workspace `.tmp/` tree,
not committed here.

## Layout

```text
topology/   # target graph, node map, address map
configs/    # demo-only endpoint/client/router config templates
state/      # demo router state-file templates
scripts/    # orchestration helpers with bounded cleanup
stages/     # ordered stage folders
```

## Stage order

| Stage | Purpose |
|---|---|
| `00-build` | Build/package sanity checks. |
| `01-router-boot` | Start root/east/west/nested routers. |
| `02-clientdummy-announce` | Start `bash-clientdummy` instances and announce all sessions. |
| `03-endpoint-boot` | Start console, session-control, timer, requestion, mailbox, and IM endpoints. |
| `04-session-update-broadcast` | Verify session updates from all dummy clients. |
| `05-control-add-prompt` | Verify canonical `control/add_prompt` paths. |
| `06-request-response` | Verify request/response read chains. |
| `07-requestion-flow` | Verify requestion ask/update/resolve/cancel paths. |
| `08-mailbox-store-forward` | Verify mailbox delivery, local store, and reminder. |
| `09-timer-im-flows` | Verify timer and IM endpoint flows. |
| `10-flow-rules-broadcast` | Verify rule-driven mirror/fanout/broadcast once available. |
| `11-full-matrix` | Run the full matrix and write summary evidence. |

## Current status

The topology graph has been refreshed. Launch scripts and `bash-clientdummy` are
follow-up implementation work.
