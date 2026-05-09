#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const targets = {
  "win32:x64": ["win32-x64", "glassvein-router.exe"],
  "linux:x64": ["linux-x64", "glassvein-router"],
  "linux:arm64": ["linux-arm64", "glassvein-router"],
};

function resolveBinary() {
  if (process.env.GLASSVEIN_ROUTER_BINARY) {
    return process.env.GLASSVEIN_ROUTER_BINARY;
  }

  const key = `${process.platform}:${process.arch}`;
  const target = targets[key];
  if (!target) {
    const supported = Object.keys(targets).join(", ");
    throw new Error(`Unsupported platform ${key}. Supported platforms: ${supported}`);
  }

  return path.join(__dirname, "..", "dist", target[0], target[1]);
}

let binary;
try {
  binary = resolveBinary();
  if (!fs.existsSync(binary)) {
    throw new Error(`GlassVein router binary not found: ${binary}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const child = spawn(binary, process.argv.slice(2), { stdio: "inherit" });

child.on("error", (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code === null ? 1 : code);
});
