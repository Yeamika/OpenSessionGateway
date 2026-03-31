import path from "node:path";

import { resolveAgentContext, runNpm } from "../_shared/run-utils.mjs";

const mode = process.argv[2] || "build";
const { repoRoot, agentDir } = resolveAgentContext(import.meta.url);
const runtimeDir = path.join(agentDir, ".runtime");
const stateFile = path.join(runtimeDir, "bridge-state", "im-gateway.json");
const serverRuntimeDir = path.join(runtimeDir, "gateway");
const ensure = [
  runtimeDir,
  path.join(runtimeDir, "bridge-state"),
  path.join(runtimeDir, "workspaces"),
  path.join(runtimeDir, "logs"),
  serverRuntimeDir,
  path.join(serverRuntimeDir, "bridge-state"),
  path.join(serverRuntimeDir, "locks"),
  path.join(serverRuntimeDir, "logs"),
];

if (mode === "probe") {
  await runNpm({
    cwd: path.join(repoRoot, "server"),
    args: ["exec", "tsx", "../plugins/IM-gateway/probe.ts"],
    env: {
      OSG_SERVER_RUNTIME_DIR: serverRuntimeDir,
      IM_GATEWAY_STATE_FILE: stateFile,
    },
    ensure,
  });
} else {
  const commands = {
    dev: ["run", "dev"],
    build: ["run", "build"],
    lint: ["run", "lint"],
  };

  if (!commands[mode]) {
    throw new Error(`Unsupported serverplug-im mode: ${mode}`);
  }

    await runNpm({
      cwd: path.join(repoRoot, "server"),
      args: commands[mode],
      env: {
        OSG_SERVER_RUNTIME_DIR: serverRuntimeDir,
        IM_GATEWAY_STATE_FILE: stateFile,
      },
      ensure,
    });
}
