import path from "node:path"

import { resolveAgentContext, runCommand } from "../_shared/run-utils.mjs"

const mode = process.argv[2] || "build"
const { repoRoot } = resolveAgentContext(import.meta.url)
const opencodeRoot = path.resolve(repoRoot, "..", "Yaemio", "opencode")
const opencodePkg = path.join(opencodeRoot, "packages", "opencode")

const actions = {
  build: { cwd: opencodePkg, args: ["run", "build"] },
  typecheck: { cwd: opencodePkg, args: ["typecheck"] },
  test: { cwd: opencodePkg, args: ["test"] },
  serve: { cwd: opencodePkg, args: ["run", "src/index.ts", "serve", "--port", "9202"] },
}

const action = actions[mode]
if (!action) throw new Error(`Unsupported opencode-dev mode: ${mode}`)

await runCommand({
  cwd: action.cwd,
  command: "bun",
  args: action.args,
})
