#!/usr/bin/env node
import { createInterface } from "node:readline"

import { ensureReceiverForCaller, ensureRouteForCaller } from "./gv-codex-app-server-bridge.mjs"
import { callHttpJsonRpcTool, errorResponse, ok, textResult } from "./gv-mcp-jsonrpc.mjs"
import { loadRegistry } from "./gv-mcp-registry.mjs"
import { startStdioJsonRpcServer } from "./gv-mcp-stdio.mjs"
import { injectedArgs, readCaller } from "./gv-session-context.mjs"

const registry = await loadRegistry()
const backendClients = new Map()
const toolIndex = await buildToolIndex(registry, backendClients)
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
let pending = Promise.resolve()

rl.on("line", (line) => {
  if (!line.trim()) return
  const request = parseJson(line)
  if (!request || request.id === undefined || request.id === null) return
  pending = pending.then(() => handleAndWrite(request))
})

rl.on("close", () => {
  pending.finally(() => {
    for (const client of backendClients.values()) client.close?.()
    process.exit(0)
  })
})

async function handleAndWrite(request) {
  try {
    write(await handleRequest(request))
  } catch (error) {
    write(errorResponse(request.id, -32603, errorMessage(error)))
  }
}

async function handleRequest(request) {
  const { id, method } = request
  if (method === "initialize") {
    return ok(id, {
      protocolVersion: "2025-03-26",
      serverInfo: { name: "gv-mcp", version: "0.1.0" },
      capabilities: { tools: { listChanged: false } },
    })
  }
  if (method === "tools/list") return ok(id, { tools: toolIndex.tools })
  if (method === "tools/call") return ok(id, await callTool(request.params || {}))
  if (method === "notifications/initialized") return ok(id, {})
  return errorResponse(id, -32601, `method not found: ${method}`)
}

async function callTool(params) {
  const exposedName = text(params.name)
  const entry = toolIndex.byName.get(exposedName)
  if (!entry) throw new Error(`unknown tool: ${exposedName}`)

  const { args: userArgs, context } = extractGvCodexContext(params.arguments)
  const caller = await readCaller(context)
  if (!caller.sessionID) {
    throw new Error("No GV Codex tool context was attached; enable the GlassVein PreToolUse hook so MCP calls can carry session ownership.")
  }
  ensureReceiverForCaller(caller)
  await ensureRouteForCaller(caller)

  const args = { ...userArgs, ...injectedArgs(caller, entry.server.inject || []) }
  const result = await callBackendTool(entry.server, entry.target, args)
  return isMcpToolResult(result) ? result : textResult(result)
}

function extractGvCodexContext(args) {
  const source = args && typeof args === "object" && !Array.isArray(args) ? args : {}
  const { __gvCodexContext, ...cleanArgs } = source
  return {
    args: cleanArgs,
    context: __gvCodexContext && typeof __gvCodexContext === "object" && !Array.isArray(__gvCodexContext)
      ? __gvCodexContext
      : null,
  }
}

async function callBackendTool(server, target, args) {
  if (server.type === "http-jsonrpc") return callHttpJsonRpcTool(server, target, args)
  if (server.type === "stdio-jsonrpc") {
    const client = backendClients.get(server.name)
    if (!client) throw new Error(`stdio backend not started: ${server.name}`)
    return client.request("tools/call", { name: target, arguments: args })
  }
  throw new Error(`unsupported backend type: ${server.type}`)
}

async function buildToolIndex(loadedRegistry, clients) {
  const tools = []
  const byName = new Map()
  const dedicatedServer = Boolean(loadedRegistry.selectedServerName)
  for (const [serverName, server] of Object.entries(loadedRegistry.servers || {})) {
    const serverTools = await resolveServerTools(serverName, server, clients)
    for (const [toolName, tool] of Object.entries(serverTools)) {
      const exposedName = tool.expose || exposedToolName(serverName, server, toolName, dedicatedServer)
      tools.push({
        name: exposedName,
        description: tool.description || `${serverName} ${toolName}`,
        inputSchema: cleanInputSchema(tool.inputSchema, server.inject || []),
      })
      byName.set(exposedName, {
        server: { ...server, name: serverName },
        target: tool.target || toolName,
      })
    }
  }
  return { tools, byName }
}

function exposedToolName(serverName, server, toolName, dedicatedServer) {
  if (dedicatedServer && server.exposePrefix === false) return toolName
  return `${server.toolPrefix || serverName}.${toolName}`
}

async function resolveServerTools(serverName, server, clients) {
  if (server.type !== "stdio-jsonrpc") return server.tools || {}

  const client = await startStdioJsonRpcServer({ ...server, name: serverName })
  clients.set(serverName, client)
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

function isMcpToolResult(result) {
  return result && typeof result === "object" && Array.isArray(result.content)
}

function parseJson(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function write(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function text(value) {
  return typeof value === "string" ? value.trim() : ""
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
