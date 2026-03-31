# OpenCode Dev Agent Workspace

## Scope

- Primary code root: `D:\ai\OPENCODE_AUTO\Yaemio\opencode\packages\opencode\`
- Use this for code changes inside core OpenCode behavior

## Read First

1. `D:\ai\OPENCODE_AUTO\Yaemio\opencode\AGENTS.md`
2. `D:\ai\OPENCODE_AUTO\Yaemio\opencode\README.md`
3. `D:\ai\OPENCODE_AUTO\Yaemio\opencode\packages\opencode\AGENTS.md`

## Commands

- Run these from `agents/opencode-dev/`:
- `npm run build`
- `npm run typecheck`
- `npm run test`
- `npm run serve`

## Boundary Rules

- Keep edits focused on `packages/opencode/` unless the change clearly belongs elsewhere.
- Respect upstream repo rules: use Bun, prefer package-dir typecheck/tests, and do not run tests from repo root.
