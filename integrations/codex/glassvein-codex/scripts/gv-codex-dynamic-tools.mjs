import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { loadFullRegistry } from "./gv-mcp-registry.mjs"
import { listHttpJsonRpcTools } from "./gv-mcp-jsonrpc.mjs"
import { startStdioJsonRpcServer } from "./gv-mcp-stdio.mjs"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const hubScript = path.join(scriptDir, "gv-mcp-hub.mjs")

export async function dynamicToolsForAppServer() {
  if (!boolEnv("GV_CODEX_APP_DYNAMIC_TOOLS", true)) return []

  const registry = await loadFullRegistry()
  const selected = selectedServerNames(Object.keys(registry.servers || {}))
  const tools = []
  for (const serverName of selected) {
    const server = registry.servers[serverName]
    if (!server) continue
    for (const [toolName, tool] of Object.entries(await resolveServerTools(serverName, server))) {
      if (!validIdentifier(serverName) || !validIdentifier(toolName)) continue
      tools.push({
        namespace: serverName,
        name: toolName,
        description: tool.description || `${serverName} ${toolName}`,
        inputSchema: cleanInputSchema(tool.inputSchema, server.inject || []),
      })
    }
  }
  return tools
}

export async function handleDynamicToolCall(params, caller = {}) {
  const namespace = text(params.namespace)
  const tool = text(params.tool)
  if (!namespace || !tool) throw new Error("GV dynamic tool call is missing namespace or tool")

  const result = await callGvHubTool({
    serverName: namespace,
    toolName: tool,
    args: objectValue(params.arguments) || {},
    context: {
      version: 1,
      runtimeID: text(caller.runtimeID) || cwdRuntime(caller.cwd),
      sessionID: text(params.threadId || params.thread_id),
      threadID: text(params.threadId || params.thread_id),
      rootSessionID: text(caller.rootSessionID || params.threadId || params.thread_id),
      turnID: text(params.turnId || params.turn_id),
      toolUseID: text(params.callId || params.call_id),
      cwd: text(caller.cwd),
    },
  })
  return {
    contentItems: mcpResultToContentItems(result),
    success: true,
  }
}

async function resolveServerTools(serverName, server) {
  if (server.type === "http-jsonrpc") {
    if (hasConfiguredTools(server)) return server.tools
    return listHttpJsonRpcTools({ ...server, name: serverName })
  }

  if (server.type !== "stdio-jsonrpc") return server.tools || {}

  const client = await startStdioJsonRpcServer({ ...server, name: serverName })
  try {
    const result = await client.request("tools/list", {})
    const discovered = Object.fromEntries((result.tools || []).map((tool) => [
      tool.name,
      {
        target: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
    ]))
    return { ...discovered, ...(server.tools || {}) }
  } finally {
    client.close()
  }
}

function hasConfiguredTools(server) {
  return Object.keys(server.tools || {}).length > 0
}

function selectedServerNames(allNames) {
  const configured = text(process.env.GV_CODEX_DYNAMIC_MCP_SERVERS)
  if (!configured) return allNames
  const requested = new Set(configured.split(/[,:;\s]+/).map((item) => item.trim()).filter(Boolean))
  return allNames.filter((name) => requested.has(name))
}

async function callGvHubTool({ serverName, toolName, args, context }) {
  const registry = await loadFullRegistry()
  const server = registry.servers?.[serverName] || {}
  const hubToolName = exposedToolName(serverName, server, toolName)
  const messages = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: hubToolName,
        arguments: {
          ...args,
          __gvCodexContext: context,
        },
      },
    },
  ]
  const result = await runHub(messages, serverName)
  const response = result.find((item) => item.id === 2)
  if (response?.error) throw new Error(response.error.message || JSON.stringify(response.error))
  return response?.result
}

function exposedToolName(serverName, server, toolName) {
  if (server.exposePrefix === false) return toolName
  return `${server.toolPrefix || serverName}.${toolName}`
}

function runHub(messages, serverName) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hubScript], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        GV_CODEX_RECEIVE_ROUTER: "0",
        GV_MCP_SERVER_NAME: serverName,
      },
      stdio: ["pipe", "pipe", "pipe"],
    })
    const responses = []
    let stdout = ""
    let stderr = ""
    const done = (error = null) => {
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(responses)
    }
    const timer = setTimeout(() => {
      child.kill()
      done(new Error(`GV dynamic tool call timed out${stderr ? `: ${stderr}` : ""}`))
    }, intEnv("GV_CODEX_DYNAMIC_TOOL_TIMEOUT_MS", 30000))

    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => {
      stdout += chunk
      let index
      while ((index = stdout.indexOf("\n")) >= 0) {
        const line = stdout.slice(0, index)
        stdout = stdout.slice(index + 1)
        const response = parseJson(line)
        if (response) responses.push(response)
      }
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.on("error", done)
    child.on("exit", (status) => {
      if (status !== 0 && !responses.some((item) => item.id === 2)) {
        done(new Error(stderr || `gv-mcp-hub exited with status ${status}`))
      } else {
        done()
      }
    })
    child.stdin.end(`${messages.map((message) => JSON.stringify(message)).join("\n")}\n`)
  })
}

function cleanInputSchema(schema, injectedNames) {
  const next = JSON.parse(JSON.stringify(schema || { type: "object", properties: {}, additionalProperties: true }))
  for (const name of injectedNames) {
    delete next.properties?.[name]
  }
  if (Array.isArray(next.required)) {
    next.required = next.required.filter((name) => !injectedNames.includes(name))
  }
  return next
}

function mcpResultToContentItems(result) {
  const content = Array.isArray(result?.content) ? result.content : []
  if (content.length === 0) return [{ type: "inputText", text: typeof result === "string" ? result : JSON.stringify(result) }]
  return content.map((item) => {
    if (item?.type === "image" && item.data) return { type: "inputImage", imageUrl: item.data }
    return { type: "inputText", text: text(item?.text) || JSON.stringify(item) }
  })
}

function validIdentifier(value) {
  return /^[A-Za-z0-9_-]{1,64}$/.test(value)
}

function cwdRuntime(cwd) {
  return text(process.env.GV_CODEX_RUNTIME) || (text(cwd) ? path.basename(cwd) : "") || "codex"
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null
}

function parseJson(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function boolEnv(name, defaultValue) {
  const raw = process.env[name]
  if (raw == null || raw === "") return defaultValue
  return /^(1|true|yes|on)$/i.test(raw)
}

function intEnv(name, defaultValue) {
  const raw = Number.parseInt(process.env[name] || "", 10)
  return Number.isFinite(raw) && raw > 0 ? raw : defaultValue
}

function text(value) {
  return typeof value === "string" ? value.trim() : ""
}
