# OpenCode Release Agent Workspace

## Scope

- Primary code roots: `D:\ai\OPENCODE_AUTO\Yaemio\opencode\`, `.github/workflows/`, `packages/opencode/script/`, `script/`
- Use this for local artifact builds, GitHub Actions release flow inspection, and local registry/publish preparation

## Read First

1. `D:\ai\OPENCODE_AUTO\Yaemio\opencode\AGENTS.md`
2. `D:\ai\OPENCODE_AUTO\Yaemio\opencode\README.md`
3. `D:\ai\OPENCODE_AUTO\Yaemio\opencode\.github\workflows\build-local-cli.yml`
4. `D:\ai\OPENCODE_AUTO\Yaemio\opencode\.github\workflows\publish.yml`

## Commands

- Run these from `agents/opencode-release/`:
- `npm run build-cli`
- `npm run build-local-cli`
- `npm run publish-script`

## Boundary Rules

- Treat GitHub release/publish operations as potentially irreversible.
- Do not publish or upload anywhere unless explicitly instructed.
- Keep local artifact generation separate from real release execution.
