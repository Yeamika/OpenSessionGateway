import { spawn } from "node:child_process"
import { createInterface } from "node:readline"

export async function startStdioJsonRpcServer(server) {
  const child = spawn(server.command, server.args || [], {
    cwd: server.cwd || process.cwd(),
    env: { ...process.env, ...(server.env || {}) },
    stdio: ["pipe", "pipe", "pipe"],
  })
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk) => {
    if (server.logStderr) process.stderr.write(`[gv-mcp:${server.name}] ${chunk}`)
  })

  let nextId = 1
  const pending = new Map()
  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity })
  rl.on("line", (line) => {
    const message = parseJson(line)
    if (!message || message.id === undefined || message.id === null) return
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) {
      request.reject(new Error(message.error.message || JSON.stringify(message.error)))
    } else {
      request.resolve(message.result)
    }
  })
  child.on("exit", () => {
    for (const request of pending.values()) request.reject(new Error(`${server.name} exited`))
    pending.clear()
  })

  const client = {
    request(method, params) {
      const id = nextId++
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`)
      return waitForResponse(id, pending, server.timeoutMs || 30000)
    },
    notify(method, params) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`)
    },
    close() {
      child.kill()
    },
  }

  await client.request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "gv-mcp-hub", version: "0.1.0" },
  })
  client.notify("notifications/initialized", {})
  return client
}

function waitForResponse(id, pending, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`stdio MCP request ${id} timed out`))
    }, timeoutMs)
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      reject: (error) => {
        clearTimeout(timer)
        reject(error)
      },
    })
  })
}

function parseJson(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
