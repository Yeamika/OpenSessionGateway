import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const currentFile = fileURLToPath(import.meta.url)
const currentDir = path.dirname(currentFile)
const serverRoot = path.resolve(currentDir, "..")
const outRoot = path.join(serverRoot, ".dist-npm")
export const packageRoot = path.join(outRoot, "package")

const copyDirs = [
  "app",
  "components",
  "lib",
  "local-plugins",
  "prisma",
  "public",
]

const copyFiles = [
  ".env.example",
  "README.md",
  "components.json",
  "next.config.ts",
  "next-env.d.ts",
  "postcss.config.mjs",
  "prisma.config.ts",
  "server.ts",
]

const buildTools = [
  "@tailwindcss/postcss",
  "@types/node",
  "@types/react",
  "@types/react-dom",
  "@types/ws",
  "cross-env",
  "prisma",
  "tailwindcss",
  "tw-animate-css",
  "tsx",
  "typescript",
]

const fileList = [
  "app",
  "bin",
  "components",
  "lib",
  "local-plugins",
  "prisma",
  "public",
  "scripts",
  ".env.example",
  "README.md",
  "components.json",
  "next.config.ts",
  "next-env.d.ts",
  "postcss.config.mjs",
  "prisma.config.ts",
  "server.ts",
  "tsconfig.json",
]

function binSource() {
  return `#!/usr/bin/env node
import fs from "node:fs"
import fsp from "node:fs/promises"
import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const meta = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
const mode = process.argv[2] || "start"
const rest = process.argv.slice(3)
const commands = {
  dev: ["run", "dev"],
  build: ["run", "build"],
  start: ["run", "start"],
  "start:ws": ["run", "start:ws"],
  "start:next": ["run", "start:next"],
  "prisma:generate": ["run", "prisma:generate"],
}

const skip = new Set([".next", ".dist-npm", "node_modules"])
const runtimeMetaFile = ".osg-runtime-meta.json"

function takeOption(flag) {
  const index = rest.findIndex((item) => item === flag)
  if (index === -1) return ""
  const value = rest[index + 1] || ""
  rest.splice(index, value ? 2 : 1)
  return value.trim()
}

function resolveWorkRoot() {
  const explicit = takeOption("--work-root") || takeOption("--runtime-dir")
  if (explicit) return path.resolve(explicit)

  const envWorkRoot = process.env.OSG_SERVER_PACKAGE_WORK_ROOT && process.env.OSG_SERVER_PACKAGE_WORK_ROOT.trim()
  if (envWorkRoot) return path.resolve(envWorkRoot)

  const legacyRuntimeDir = process.env.OSG_SERVER_PACKAGE_RUNTIME_DIR && process.env.OSG_SERVER_PACKAGE_RUNTIME_DIR.trim()
  if (legacyRuntimeDir) return path.resolve(legacyRuntimeDir, meta.version)

  process.stderr.write("OSG_SERVER_PACKAGE_WORK_ROOT is required (or use --work-root <dir>)\\n")
  process.exit(1)
}

async function sync(src, dst) {
  const stat = await fsp.stat(src)
  if (stat.isDirectory()) {
    await fsp.mkdir(dst, { recursive: true })
    const rows = await fsp.readdir(src)
    for (const name of rows) {
      if (skip.has(name)) continue
      await sync(path.join(src, name), path.join(dst, name))
    }
    return
  }
  await fsp.mkdir(path.dirname(dst), { recursive: true })
  await fsp.copyFile(src, dst)
}

function nodeModulesRoot() {
  let dir = root
  while (true) {
    const hit = path.join(dir, "node_modules")
    if (fs.existsSync(path.join(hit, "next", "package.json"))) return hit
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error("Unable to locate installed dependencies for @opensessiongateway/server")
}

async function ensureWritableNodeModules(dir) {
  const src = nodeModulesRoot()
  const dst = path.join(dir, "node_modules")
  const metaPath = path.join(dir, runtimeMetaFile)
  const expected = {
    version: meta.version,
    sourceRoot: root,
  }

  let shouldSync = true
  try {
    const raw = await fsp.readFile(metaPath, "utf8")
    const parsed = JSON.parse(raw)
    if (
      parsed &&
      parsed.version === expected.version &&
      parsed.sourceRoot === expected.sourceRoot &&
      fs.existsSync(dst)
    ) {
      shouldSync = false
    }
  } catch {}

  if (shouldSync) {
    await fsp.rm(dst, { force: true, recursive: true })
    await fsp.cp(src, dst, { force: true, recursive: true })
    await fsp.writeFile(metaPath, JSON.stringify(expected, null, 2) + "\\n", "utf8")
  }
}

async function runtimeRoot() {
  const dir = resolveWorkRoot()
  await fsp.mkdir(dir, { recursive: true })

  for (const name of await fsp.readdir(root)) {
    if (skip.has(name)) continue
    await sync(path.join(root, name), path.join(dir, name))
  }

  await ensureWritableNodeModules(dir)
  return dir
}

if (!commands[mode]) {
  process.stderr.write(\`Unsupported osg-server mode: \${mode}\\n\`)
  process.exit(1)
}

const dir = await runtimeRoot()
const env = {
  ...process.env,
  OSG_SERVER_PACKAGE_SOURCE_ROOT: root,
  OSG_SERVER_PACKAGE_WORK_ROOT: dir,
}

if (mode === "build" && !env.REDIS_URL) {
  env.REDIS_URL = "redis://127.0.0.1:6379"
}

const child = spawn("npm", [...commands[mode], ...rest], {
  cwd: dir,
  env,
  stdio: "inherit",
})

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})

child.on("error", (error) => {
  process.stderr.write(String(error) + "\\n")
  process.exit(1)
})
`
}

function prismaSource() {
  return `#!/usr/bin/env node
import fs from "node:fs"
import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const exe = process.platform === "win32" ? "prisma.cmd" : "prisma"
const prisma = [
  path.join(root, "node_modules", ".bin", exe),
  path.resolve(root, "..", "..", ".bin", exe),
].find((item) => fs.existsSync(item))

if (!prisma) {
  process.stderr.write("Unable to locate prisma binary\\n")
  process.exit(1)
}

const child = spawn(prisma, ["generate", "--schema", "prisma/schema.prisma"], {
  cwd: root,
  env: {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/opensessiongateway",
  },
  stdio: "inherit",
})

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})

child.on("error", (error) => {
  process.stderr.write(String(error) + "\\n")
  process.exit(1)
})
`
}

function nextConfigSource() {
  return `import path from "node:path"
import { fileURLToPath } from "node:url"
import type { NextConfig } from "next"

const currentFile = fileURLToPath(import.meta.url)
const currentDir = path.dirname(currentFile)

const nextConfig: NextConfig = {
  experimental: {
    externalDir: true,
  },
  turbopack: {
    root: currentDir,
  },
  transpilePackages: ["@opensessiongateway/protocol-library"],
}

export default nextConfig
`
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"))
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

async function copyIntoPackage(relativePath) {
  try {
    await fs.cp(path.join(serverRoot, relativePath), path.join(packageRoot, relativePath), {
      force: true,
      recursive: true,
    })
  } catch (error) {
    if (error instanceof Error && error.code === "ENOENT") return
    throw error
  }
}

function packageJson(src) {
  const dependencies = { ...src.dependencies }
  for (const name of buildTools) {
    const value = src.devDependencies?.[name]
    if (value) dependencies[name] = value
  }

  return {
    name: "@opensessiongateway/server",
    version: typeof process.env.OSG_SERVER_PACKAGE_VERSION === "string" && process.env.OSG_SERVER_PACKAGE_VERSION.trim()
      ? process.env.OSG_SERVER_PACKAGE_VERSION.trim()
      : src.version,
    description: "OpenSessionGateway server runtime package",
    type: "module",
    private: false,
    bin: {
      "osg-server": "./bin/osg-server.mjs",
    },
    scripts: {
      "prisma:generate": "node scripts/prisma-generate.mjs",
      postinstall: "npm run prisma:generate",
      dev: "tsx --tsconfig tsconfig.json server.ts",
      "dev:next": src.scripts["dev:next"],
      build: "npm run prisma:generate && next build --webpack",
      start: src.scripts.start,
      "start:ws": "cross-env NODE_ENV=production tsx --tsconfig tsconfig.json server.ts",
      "start:next": src.scripts["start:next"],
    },
    dependencies,
    files: fileList,
  }
}

function tsconfigJson(src) {
  return {
    ...src,
    compilerOptions: {
      ...src.compilerOptions,
      paths: {
        "@/*": ["./*"],
      },
    },
    include: [
      "next-env.d.ts",
      "**/*.ts",
      "**/*.tsx",
      "local-plugins/**/*.ts",
      "local-plugins/**/*.mts",
      ".next/types/**/*.ts",
      ".next/dev/types/**/*.ts",
      "**/*.mts",
    ],
  }
}

export async function buildPackage() {
  await fs.rm(outRoot, { force: true, recursive: true })
  await fs.mkdir(packageRoot, { recursive: true })

  for (const relativePath of copyDirs) {
    await copyIntoPackage(relativePath)
  }

  for (const relativePath of copyFiles) {
    await copyIntoPackage(relativePath)
  }

  const srcPkg = await readJson(path.join(serverRoot, "package.json"))
  const srcTsconfig = await readJson(path.join(serverRoot, "tsconfig.json"))

  await writeJson(path.join(packageRoot, "package.json"), packageJson(srcPkg))
  await writeJson(path.join(packageRoot, "tsconfig.json"), tsconfigJson(srcTsconfig))
  await fs.writeFile(path.join(packageRoot, "next.config.ts"), `${nextConfigSource()}\n`, "utf8")

  const binDir = path.join(packageRoot, "bin")
  await fs.mkdir(binDir, { recursive: true })
  await fs.writeFile(path.join(binDir, "osg-server.mjs"), binSource(), "utf8")
  await fs.chmod(path.join(binDir, "osg-server.mjs"), 0o755)

  const scriptsDir = path.join(packageRoot, "scripts")
  await fs.mkdir(scriptsDir, { recursive: true })
  await fs.writeFile(path.join(scriptsDir, "prisma-generate.mjs"), prismaSource(), "utf8")
  await fs.chmod(path.join(scriptsDir, "prisma-generate.mjs"), 0o755)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildPackage()
  process.stdout.write(`${packageRoot}\n`)
}
