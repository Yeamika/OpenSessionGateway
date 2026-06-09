#!/usr/bin/env node
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const MANAGED_START = "# BEGIN GlassVein Codex MCP"
const MANAGED_END = "# END GlassVein Codex MCP"

export async function configureCodexMcp(options = {}) {
  const registryFile = await resolveRegistryFile(options.registryFile)
  const registry = normalizeRegistry(JSON.parse(await fs.readFile(registryFile, "utf8")))
  const serverNames = selectServerNames(registry, options.servers)
  const configFile = resolveConfigFile(options.configFile)
  const hubScript = resolveHubScript(options.hubScript)

  const current = await readOptional(configFile)
  const stripped = stripManagedBlock(current)
  const collisions = serverNames.filter((name) => parseMcpServerNames(stripped).has(name))
  if (collisions.length > 0) {
    throw new Error(`Codex config already has unmanaged MCP server entries: ${collisions.join(", ")}`)
  }

  const block = renderManagedBlock({ serverNames, registryFile, hubScript })
  const next = joinConfig(stripped, block)
  if (!options.dryRun) {
    await fs.mkdir(path.dirname(configFile), { recursive: true })
    await fs.writeFile(configFile, next, "utf8")
  }

  return {
    configFile,
    registryFile,
    serverNames,
    dryRun: Boolean(options.dryRun),
    content: next,
  }
}

export function renderManagedBlock({ serverNames, registryFile, hubScript }) {
  const lines = [
    MANAGED_START,
    "# Managed by glassvein-codex/scripts/gv-codex-configure-mcp.mjs.",
  ]
  for (const name of serverNames) {
    lines.push(
      "",
      `[mcp_servers.${tomlKey(name)}]`,
      'command = "node"',
      `args = [${tomlString(hubScript)}]`,
      "",
      `[mcp_servers.${tomlKey(name)}.env]`,
      `GV_MCP_REGISTRY_FILE = ${tomlString(registryFile)}`,
      `GV_MCP_SERVER_NAME = ${tomlString(name)}`,
    )
  }
  lines.push("", MANAGED_END)
  return lines.join("\n")
}

export function stripManagedBlock(content) {
  const start = escapeRegExp(MANAGED_START)
  const end = escapeRegExp(MANAGED_END)
  return String(content || "")
    .replace(new RegExp(`\\n?${start}[\\s\\S]*?${end}\\n?`, "g"), "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()
}

export function parseMcpServerNames(content) {
  const names = new Set()
  for (const rawLine of String(content || "").split("\n")) {
    const line = rawLine.trim()
    const match = /^\[mcp_servers\.((?:"(?:\\.|[^"\\])*")|(?:[A-Za-z0-9_-]+))(?:\.env)?\]$/.exec(line)
    if (match) names.add(unquoteTomlKey(match[1]))
  }
  return names
}

function normalizeRegistry(registry) {
  return { servers: { ...(registry?.servers || {}) } }
}

function selectServerNames(registry, selected) {
  const available = Object.keys(registry.servers || {})
  const requested = selected?.length ? selected : available
  const missing = requested.filter((name) => !registry.servers[name])
  if (missing.length > 0) {
    throw new Error(`MCP servers not found in registry: ${missing.join(", ")}`)
  }
  for (const name of requested) {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
      throw new Error(`MCP server name must use only letters, numbers, "_" or "-": ${name}`)
    }
  }
  if (requested.length === 0) {
    throw new Error("MCP registry does not contain any servers")
  }
  return requested
}

async function resolveRegistryFile(configured) {
  const candidates = []
  if (configured) candidates.push(configured)
  for (const value of [process.env.GV_MCP_REGISTRY_FILE, process.env.GV_CODEX_MCP_REGISTRY_FILE]) {
    if (value) candidates.push(...value.split(path.delimiter).filter(Boolean))
  }
  candidates.push(path.resolve(process.cwd(), "gv-mcp.registry.json"))

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate)
    try {
      const stat = await fs.stat(resolved)
      if (stat.isFile()) return resolved
    } catch {}
  }
  throw new Error("No GV MCP registry found; pass --registry /path/to/gv-mcp.registry.json")
}

function resolveConfigFile(configured) {
  if (configured) return path.resolve(configured)
  return path.join(codexHome(), "config.toml")
}

function resolveHubScript(configured) {
  if (configured) return path.resolve(configured)
  return path.join(pluginRoot(), "scripts", "gv-mcp-hub.mjs")
}

function codexHome() {
  return path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"))
}

function pluginRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
}

async function readOptional(file) {
  try {
    return await fs.readFile(file, "utf8")
  } catch (error) {
    if (error?.code === "ENOENT") return ""
    throw error
  }
}

function joinConfig(content, block) {
  return `${[content, block].filter(Boolean).join("\n\n")}\n`
}

function tomlKey(value) {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : tomlString(value)
}

function tomlString(value) {
  return JSON.stringify(String(value))
}

function unquoteTomlKey(value) {
  if (!value.startsWith("\"")) return value
  try {
    return JSON.parse(value)
  } catch {
    return value.slice(1, -1)
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function parseArgs(argv) {
  const options = { servers: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--registry") options.registryFile = requireValue(argv, ++index, arg)
    else if (arg === "--config") options.configFile = requireValue(argv, ++index, arg)
    else if (arg === "--servers") options.servers = splitList(requireValue(argv, ++index, arg))
    else if (arg === "--dry-run") options.dryRun = true
    else if (arg === "--help" || arg === "-h") options.help = true
    else throw new Error(`Unknown option: ${arg}`)
  }
  return options
}

function requireValue(argv, index, flag) {
  const value = argv[index]
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`)
  return value
}

function splitList(value) {
  return value.split(/[,:;\s]+/).map((item) => item.trim()).filter(Boolean)
}

function usage() {
  return [
    "Usage: node scripts/gv-codex-configure-mcp.mjs --registry /path/to/gv-mcp.registry.json [--servers refs,timer] [--config /path/to/config.toml] [--dry-run]",
    "",
    "Writes one static Codex MCP entry per selected GV registry server.",
    "Restart Codex after writing the config so the static MCP list is loaded.",
  ].join("\n")
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(usage())
    return
  }
  const result = await configureCodexMcp(options)
  console.log(`GlassVein Codex MCP config ${result.dryRun ? "rendered" : "updated"}`)
  console.log(`config: ${result.configFile}`)
  console.log(`registry: ${result.registryFile}`)
  console.log(`servers: ${result.serverNames.join(", ")}`)
  if (!result.dryRun) console.log("Restart Codex to load newly configured MCP servers.")
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
