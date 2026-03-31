import path from "node:path"

import { resolveAgentContext, runCommand } from "../_shared/run-utils.mjs"

const mode = process.argv[2] || "typecheck"
const { repoRoot } = resolveAgentContext(import.meta.url)
const opencodeRoot = path.resolve(repoRoot, "..", "Yaemio", "opencode")
const opencodePkg = path.join(opencodeRoot, "packages", "opencode")

const actions = {
  typecheck: ["typecheck"],
  test: ["test"],
  build: ["run", "build"],
}

const args = actions[mode]
if (!args) throw new Error(`Unsupported opencode-test mode: ${mode}`)

await runCommand({
  cwd: opencodePkg,
  command: "bun",
  args,
})
