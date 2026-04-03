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

async function runPackage(relativeDir, args, extra = {}) {
  await runNpm({
    cwd: path.join(repoRoot, relativeDir),
    args,
    ensure,
    ...extra,
  });
}

switch (mode) {
  case "build-sdk":
    await runPackage(path.join("packages", "server-plugin-sdk"), ["run", "build"]);
    break;
  case "build-runtime-control":
    await runPackage(path.join("plugins", "runtime-control"), ["run", "build"]);
    break;
  case "build-session-bridge":
    await runPackage(path.join("plugins", "session-bridge"), ["run", "build"]);
    break;
  case "build-timer-scheduler":
    await runPackage(path.join("plugins", "timer-scheduler"), ["run", "build"]);
    break;
  case "build":
    await runPackage(path.join("packages", "server-plugin-sdk"), ["run", "build"]);
    await runPackage(path.join("plugins", "runtime-control"), ["run", "build"]);
    await runPackage(path.join("plugins", "session-bridge"), ["run", "build"]);
    await runPackage(path.join("plugins", "timer-scheduler"), ["run", "build"]);
    break;
  case "dev":
  case "lint": {
    const command = {
      dev: ["run", "dev"],
      lint: ["run", "lint"],
    }[mode];

    await runPackage("server", command, { env });
    break;
  }
  default:
    throw new Error(`Unsupported serverplug-core mode: ${mode}`);
}
