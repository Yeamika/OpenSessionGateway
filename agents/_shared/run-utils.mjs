import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function resolveAgentContext(metaUrl) {
  const agentDir = path.dirname(fileURLToPath(metaUrl));
  const repoRoot = path.resolve(agentDir, "..", "..");
  return { agentDir, repoRoot };
}

function npmBinary() {
  return "npm";
}

function windowsQuote(value) {
  if (!/[\s"]/u.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

export async function ensureDirs(paths) {
  await Promise.all(paths.map((dir) => fs.mkdir(dir, { recursive: true })));
}

export async function runNpm({ cwd, args, env = {}, ensure = [] }) {
  if (ensure.length) {
    await ensureDirs(ensure);
  }

  await new Promise((resolve, reject) => {
    const command = process.platform === "win32"
      ? ["cmd.exe", ["/d", "/s", "/c", `npm ${args.map(windowsQuote).join(" ")}`]]
      : [npmBinary(), args];
    const child = spawn(command[0], command[1], {
      cwd,
      env: {
        ...process.env,
        ...env,
      },
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`npm ${args.join(" ")} failed (${signal || code || "unknown"})`));
    });
  });
}

export async function runCommand({ cwd, command, args, env = {}, ensure = [] }) {
  if (ensure.length) {
    await ensureDirs(ensure)
  }

  await new Promise((resolve, reject) => {
    const exe = process.platform === "win32"
      ? ["cmd.exe", ["/d", "/s", "/c", `${command} ${args.map(windowsQuote).join(" ")}`]]
      : [command, args]
    const child = spawn(exe[0], exe[1], {
      cwd,
      env: {
        ...process.env,
        ...env,
      },
      stdio: "inherit",
    })

    child.on("error", reject)
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${command} ${args.join(" ")} failed (${signal || code || "unknown"})`))
    })
  })
}
