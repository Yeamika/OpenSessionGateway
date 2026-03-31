import path from "node:path"

import { resolveAgentContext, runCommand } from "../_shared/run-utils.mjs"

const mode = process.argv[2] || "build-cli"
const { repoRoot } = resolveAgentContext(import.meta.url)
const opencodeRoot = path.resolve(repoRoot, "..", "Yaemio", "opencode")
const opencodePkg = path.join(opencodeRoot, "packages", "opencode")

if (mode === "build-cli") {
  await runCommand({ cwd: opencodePkg, command: "bun", args: ["run", "build"] })
} else if (mode === "build-local-cli") {
  await runCommand({ cwd: opencodeRoot, command: "bun", args: ["run", ".github/workflows/build-local-cli.yml"] })
} else if (mode === "publish-script") {
  await runCommand({ cwd: opencodeRoot, command: "bun", args: ["run", "script/publish.ts"] })
} else {
  throw new Error(`Unsupported opencode-release mode: ${mode}`)
}
