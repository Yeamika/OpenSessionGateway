import path from "node:path";

import { resolveAgentContext, runNpm } from "../_shared/run-utils.mjs";

const mode = process.argv[2] || "build";
const { repoRoot, agentDir } = resolveAgentContext(import.meta.url);
const runtimeDir = path.join(agentDir, ".runtime");
const gatewayRuntimeDir = path.join(runtimeDir, "gateway");
const env = {
  OSG_SERVER_RUNTIME_DIR: gatewayRuntimeDir,
  OSG_PLUGIN_AUTOLOAD_ALLOW: "runtime-control,session-bridge,timer-scheduler",
};
const ensure = [
  runtimeDir,
  path.join(runtimeDir, "logs"),
  gatewayRuntimeDir,
  path.join(gatewayRuntimeDir, "bridge-state"),
  path.join(gatewayRuntimeDir, "locks"),
  path.join(gatewayRuntimeDir, "logs"),
];

switch (mode) {
  case "build-sdk":
    await runNpm({
      cwd: path.join(repoRoot, "packages", "server-plugin-sdk"),
      args: ["run", "build"],
      ensure,
    });
    break;
  case "dev":
  case "build":
  case "lint": {
    const command = {
      dev: ["run", "dev"],
      build: ["run", "build"],
      lint: ["run", "lint"],
    }[mode];

    await runNpm({
      cwd: path.join(repoRoot, "server"),
      args: command,
      env,
      ensure,
    });
    break;
  }
  default:
    throw new Error(`Unsupported serverplug-core mode: ${mode}`);
}
