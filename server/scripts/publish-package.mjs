import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { buildPackage, packageRoot } from "./build-package.mjs"

const currentFile = fileURLToPath(import.meta.url)
const currentDir = path.dirname(currentFile)
const serverRoot = path.resolve(currentDir, "..")

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: serverRoot,
      env: process.env,
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

const registry = typeof process.env.OSG_LOCAL_REGISTRY === "string" && process.env.OSG_LOCAL_REGISTRY.trim()
  ? process.env.OSG_LOCAL_REGISTRY.trim()
  : typeof process.env.npm_config_registry === "string" && process.env.npm_config_registry.trim()
    ? process.env.npm_config_registry.trim()
    : "http://host.docker.internal:4873/"

await buildPackage()
process.stdout.write(`Publishing ${packageRoot} to ${registry}\n`)
await run("npm", ["publish", packageRoot, "--registry", registry])
