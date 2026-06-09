---
name: glassvein
description: Work on GlassVein, GV, OSGP, or the GlassVein Codex/opencode integrations.
---

# GlassVein

Use this skill when the task mentions GlassVein, GV, OSGP, the opencode GV plugin, or this Codex plugin.

## Working Rules

- Read the nearest `AGENTS.md` chain before editing.
- Put GlassVein implementation changes under the `GlassVein/` repo, not the old OSG code line.
- Treat `integrations/opencode/plugin/` as the canonical opencode GV plugin.
- Treat `integrations/codex/glassvein-codex/` as the Codex plugin that captures Codex hook state and injects bounded GV context.
- Do not write credentials, tokens, or full prompts into docs.
- Keep TypeScript and JavaScript files under 500 lines where practical.

## Codex Hook Notes

- `UserPromptSubmit` receives `session_id`, `turn_id`, `cwd`, `model`, `permission_mode`, `prompt`, and `transcript_path`.
- `UserPromptSubmit` can add model-visible context with `hookSpecificOutput.additionalContext`; it does not mutate the original user prompt.
- `Stop` can record that a Codex turn finished and optionally publish a final `session_update`.
- Full prompt capture is disabled by default; use previews and hashes unless the user explicitly asks for full prompt capture.
