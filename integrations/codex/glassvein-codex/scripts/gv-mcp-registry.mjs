import { promises as fs } from "node:fs"
import path from "node:path"

export async function loadRegistry() {
  const configured = await readConfiguredRegistry()
  return selectRegistry(normalizeRegistry(configured))
}

export async function loadFullRegistry() {
  const configured = await readConfiguredRegistry()
  return normalizeRegistry(configured)
}

async function readConfiguredRegistry() {
  const files = registryFiles()
  for (const file of files) {
    try {
      return JSON.parse(await fs.readFile(file, "utf8"))
    } catch {}
  }
  return {}
}

function registryFiles() {
  const configured = process.env.GV_MCP_REGISTRY_FILE || process.env.GV_CODEX_MCP_REGISTRY_FILE
  const files = configured ? configured.split(path.delimiter).filter(Boolean) : []
  files.push(path.resolve(process.cwd(), "gv-mcp.registry.json"))
  return files
}

function normalizeRegistry(registry) {
  const result = { servers: {} }
  for (const [name, server] of Object.entries(registry.servers || {})) {
    result.servers[name] = { ...server, name, tools: { ...(server.tools || {}) } }
  }
  return result
}

function selectRegistry(registry) {
  const serverName = selectedServerName()
  if (!serverName) return { ...registry, selectedServerName: null }

  const server = registry.servers[serverName]
  if (!server) {
    const available = Object.keys(registry.servers)
    const suffix = available.length > 0 ? ` Available servers: ${available.join(", ")}.` : ""
    throw new Error(`GV_MCP_SERVER_NAME=${serverName} was not found in the MCP registry.${suffix}`)
  }

  return {
    selectedServerName: serverName,
    servers: {
      [serverName]: server,
    },
  }
}

function selectedServerName() {
  const raw = process.env.GV_MCP_SERVER_NAME || process.env.GV_CODEX_MCP_SERVER_NAME || ""
  return raw.trim() || null
}
