import fs from "node:fs/promises";
import path from "node:path";

import { resolveAgentContext, runCommand, runNpm } from "../_shared/run-utils.mjs";

const mode = process.argv[2] || "build";
const commands = {
  dev: ["run", "dev"],
  build: ["run", "build"],
  lint: ["run", "lint"],
  start: ["run", "start:ws"],
};

const { repoRoot, agentDir } = resolveAgentContext(import.meta.url);
const runtimeDir = path.join(agentDir, ".runtime");

function slash(value) {
  return value.replace(/\\/g, "/");
}

function normalizePluginArg(value) {
  const clean = (value || "").trim().replace(/^plugins[\\/]/, "").replace(/[\\/]+$/g, "");
  if (!clean) {
    throw new Error("pluginbuild requires at least one plugin name, e.g. npm run pluginbuild -- timer-scheduler");
  }
  if (clean.includes("..")) {
    throw new Error(`pluginbuild does not allow parent traversal: ${value}`);
  }
  return clean;
}

async function pluginExists(pluginDir) {
  try {
    const stat = await fs.stat(pluginDir);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function runPluginBuild(pluginNames) {
  await fs.mkdir(runtimeDir, { recursive: true });
  const serverDir = path.join(repoRoot, "server");
  const tempConfigs = [];

  try {
    for (const pluginName of pluginNames) {
      const pluginDir = path.join(repoRoot, "plugins", pluginName);
      if (!(await pluginExists(pluginDir))) {
        throw new Error(`pluginbuild target not found: plugins/${pluginName}`);
      }

      const safeName = pluginName.replace(/[\\/]/g, "__");
      const tempConfigPath = path.join(runtimeDir, `pluginbuild-${safeName}.tsconfig.json`);
      const config = {
        extends: slash(path.relative(runtimeDir, path.join(serverDir, "tsconfig.json"))),
        include: [
          slash(path.relative(runtimeDir, path.join(serverDir, "next-env.d.ts"))),
          `${slash(path.relative(runtimeDir, pluginDir))}/**/*.ts`,
          `${slash(path.relative(runtimeDir, pluginDir))}/**/*.tsx`,
          `${slash(path.relative(runtimeDir, pluginDir))}/**/*.mts`,
        ],
        exclude: ["node_modules"],
      };
      await fs.writeFile(tempConfigPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
      tempConfigs.push(tempConfigPath);

      await runCommand({
        cwd: serverDir,
        command: "npx",
        args: ["tsc", "-p", tempConfigPath, "--pretty", "false"],
        env: {
          OSG_SERVER_RUNTIME_DIR: runtimeDir,
        },
      });
    }
  } finally {
    await Promise.all(tempConfigs.map((file) => fs.rm(file, { force: true })));
  }
}

if (mode === "pluginbuild") {
  const pluginNames = process.argv.slice(3).map(normalizePluginArg);
  await runPluginBuild(pluginNames);
} else {
  if (!commands[mode]) {
    throw new Error(`Unsupported server mode: ${mode}`);
  }

  await runNpm({
    cwd: path.join(repoRoot, "server"),
    args: commands[mode],
    env: {
      OSG_SERVER_RUNTIME_DIR: runtimeDir,
    },
    ensure: [
      runtimeDir,
      path.join(runtimeDir, "bridge-state"),
      path.join(runtimeDir, "locks"),
      path.join(runtimeDir, "logs"),
      path.join(runtimeDir, "heap"),
    ],
  });
}
