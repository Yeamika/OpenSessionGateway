import path from "node:path";

import { resolveAgentContext, runNpm } from "../_shared/run-utils.mjs";

const mode = process.argv[2] || "build";
const commands = {
  dev: ["run", "dev"],
  build: ["run", "build"],
  lint: ["run", "lint"],
  start: ["run", "start"],
};

if (!commands[mode]) {
  throw new Error(`Unsupported web mode: ${mode}`);
}

const { repoRoot } = resolveAgentContext(import.meta.url);

await runNpm({
  cwd: path.join(repoRoot, "web"),
  args: commands[mode],
});
