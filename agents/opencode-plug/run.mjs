import path from "node:path";

import { resolveAgentContext, runNpm } from "../_shared/run-utils.mjs";

const mode = process.argv[2] || "build";
const { repoRoot, agentDir } = resolveAgentContext(import.meta.url);
const runtimeDir = path.join(agentDir, ".runtime");
const env = {
  OSG_LOG_DIR: path.join(runtimeDir, "opensessiongateway"),
  OSG_FLEET_BASE_DIR: path.join(runtimeDir, "workspaces", "client-template-fleet"),
};
const ensure = [
  runtimeDir,
  path.join(runtimeDir, "opensessiongateway"),
  path.join(runtimeDir, "logs"),
  path.join(runtimeDir, "workspaces", "client-template-fleet"),
];

async function runPackage(relativeDir, args) {
  await runNpm({
    cwd: path.join(repoRoot, relativeDir),
    args,
    env,
    ensure,
  });
}

switch (mode) {
  case "build":
    await runPackage(path.join("packages", "client-library"), ["run", "build"]);
    await runPackage(path.join("packages", "client-opencode-plugin-v2"), ["run", "build"]);
    await runPackage(path.join("packages", "client-template"), ["run", "build"]);
    break;
  case "build-library":
    await runPackage(path.join("packages", "client-library"), ["run", "build"]);
    break;
  case "build-plugin":
    await runPackage(path.join("packages", "client-opencode-plugin-v2"), ["run", "build"]);
    break;
  case "build-template":
    await runPackage(path.join("packages", "client-template"), ["run", "build"]);
    break;
  case "fleet":
    await runPackage(path.join("packages", "client-template"), ["run", "fleet:cli"]);
    break;
  default:
    throw new Error(`Unsupported opencode-plug mode: ${mode}`);
}
