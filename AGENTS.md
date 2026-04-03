# OpenSessionGateway Agent Notes

## Agent Workspaces

Use the dedicated workspaces under `agents/` when you want a scoped maintenance surface.
Those folders are where agent-local runtime state, helper scripts, and ownership notes live.
Keep product code in `web/`, `server/`, `packages/`, and `plugins/`.

Current agent workspaces:

1. `agents/web/`
2. `agents/server/`
3. `agents/opencode-plug/`
4. `agents/serverplug-im/`
5. `agents/serverplug-core/`
6. `agents/opencode-dev/`
7. `agents/opencode-test/`
8. `agents/opencode-release/`

Shared OpenCode config root:

- `agents/opencode-global/.opencode/`

## Execution Rule

- Install dependencies once from the repo root so workspaces share the root `node_modules/`.
- Run runtime, dev, lint, and build commands from `agents/*` wrappers, not from `web/`, `server/`, `packages/`, or `plugins/` directly.
- Deployment and test execution for OSG surfaces must run inside the project containers, not directly on the host machine.
- When verifying server, plugin, or runtime behavior, prefer the `docker/osg-opencode-suite/` container flows and treat host-only verification as insufficient unless explicitly requested.

## Container Usage Rule

The following containers are part of the active OSG/OpenCode lab environment:

1. `osg-test`
2. `opencode-test-community-event`
3. `developerscontain`
4. `opencode-test-a`
5. `opencode-test-b`
6. `main-osg`

Container handling policy:

- `developerscontain`, `main-osg`, and `opencode-test-community-event` are protected containers. Do not stop, restart, recreate, or modify them unless explicitly instructed.
- `osg-test`, `opencode-test-a`, and `opencode-test-b` may be used for testing and verification work.
- When running deployment or validation steps, prefer the test containers first and avoid production containers unless the task explicitly targets production behavior.

## What To Understand First

If you are maintaining OSG, start from the server-side structural model, not from whichever bridge or client file you opened first.

Read these docs first:

1. `docs/README.md`
2. `docs/_shared/project-overview.md`
3. `docs/_shared/concepts-and-terms.md`
4. `docs/backend/architecture-and-dataflow.md`
5. `docs/backend/mcp-endpoints-and-tools.md`
6. `docs/backend/runtime-session-workspace-model.md`
7. `docs/backend/persistence-and-mailbox-notes.md`
8. `docs/_shared/maintenance-guidance/server-maintenance-outline.md`
9. `docs/_shared/maintenance-guidance/server-pitfalls-and-maintenance-checklist.md`
10. `docs/_shared/maintenance-guidance/protocol-vs-server-vs-client-status.md`

## Stable Mental Model

Reason about OSG in this order:

1. runtime
2. session
3. workspace
4. WebSocket live state flow
5. MCP control surface
6. bridge integration assumptions
7. persistence and restart behavior

Do not assume:

- protocol definition means full implementation,
- server state is durable,
- mailbox is only a passive inbox,
- runtime control and session bridge are the same thing.

## Maintenance Bias

- Default to reading `server/` before concluding how OSG works.
- Treat `runtimeID` as the root live routing anchor.
- Document uncertainty explicitly when behavior is only inferred from code inspection.
- Prefer adding docs when structure becomes confusing instead of relying on memory.

## Routing and Variable Provenance Rule

- Forbid fallback-based routing and context guessing in product code.
- Do not rely on current/default/active/first-match assumptions when targeting something specific.
- Routing context must come from an explicit source of truth with a clear derivation path.
- If exact targeting cannot be resolved, fail closed instead of guessing.
- Avoid hidden chains that mix unrelated local context into target selection.

## Interface Change Bias

- When an interface is redesigned, prefer full removal of the old one over compatibility shims.
- Do not keep legacy parameters or dual-shape behavior unless a migration period is explicitly required.
- Prefer hard removal or hard failure over silently accepting old inputs.
- Keep one active contract, not multiple historical ones.

## Naming Caution

The repo currently includes real misspelled identifiers such as:

- `AddPromot`
- `ClientContentExecuteing`

Do not silently "correct" these in code-facing instructions when searchability matters.
Use correct English in prose, but preserve exact identifiers when pointing people to code.
