import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

test("GV MCP hub keeps PreToolUse context isolated across Codex threads", async () => {
  const temp = mkdtempSync(path.join(tmpdir(), "gv-mcp-thread-context-"))
  const seen = []
  const server = createServer((req, res) => {
    let raw = ""
    req.on("data", (chunk) => {
      raw += chunk
    })
    req.on("end", () => {
      seen.push({ url: req.url, body: JSON.parse(raw) })
      res.setHeader("content-type", "application/json")
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: "server",
        result: { content: [{ type: "text", text: "ok" }] },
      }))
    })
  })

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const registryFile = path.join(temp, "registry.json")
    writeFileSync(registryFile, JSON.stringify({
      servers: {
        demo: {
          type: "http-jsonrpc",
          url: `http://127.0.0.1:${server.address().port}/mcp/demo`,
          runtimeQueryParam: "runtimeID",
          inject: [
            "ExecutorRuntimeID",
            "ExecutorSessionID",
            "ExecutorThreadID",
            "ExecutorRootSessionID",
            "ExecutorTurnID",
            "ExecutorToolUseID",
          ],
          tools: {
            ping: {
              target: "Ping",
              inputSchema: { type: "object", properties: {}, additionalProperties: true },
            },
          },
        },
      },
    }), "utf8")

    const result = await runHub([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      toolCall(2, "runtime-a", "root-a", "thread-a", "turn-a", "tool-a"),
      toolCall(3, "runtime-b", "root-b", "thread-b", "turn-b", "tool-b"),
    ], {
      GV_CODEX_RECEIVE_ROUTER: "0",
      GV_MCP_REGISTRY_FILE: registryFile,
    })

    assert.equal(result.status, 0, result.stderr)
    const lines = result.stdout.trim().split("\n").map((line) => JSON.parse(line))
    assert.equal(lines[1].result.content[0].text, "ok")
    assert.equal(lines[2].result.content[0].text, "ok")
    assert.equal(seen.length, 2)
    assert.equal(seen[0].url, "/mcp/demo?runtimeID=runtime-a")
    assert.equal(seen[1].url, "/mcp/demo?runtimeID=runtime-b")
    assert.deepEqual(seen.map((item) => item.body.params.arguments), [
      injectedArgs("runtime-a", "root-a", "thread-a", "turn-a", "tool-a"),
      injectedArgs("runtime-b", "root-b", "thread-b", "turn-b", "tool-b"),
    ])
  } finally {
    server.close()
    rmSync(temp, { recursive: true, force: true })
  }
})

function toolCall(id, runtimeID, rootSessionID, threadID, turnID, toolUseID) {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: {
      name: "demo.ping",
      arguments: {
        __gvCodexContext: {
          version: 1,
          runtimeID,
          sessionID: threadID,
          threadID,
          rootSessionID,
          turnID,
          toolUseID,
          cwd: pluginRoot,
        },
      },
    },
  }
}

function injectedArgs(runtimeID, rootSessionID, threadID, turnID, toolUseID) {
  return {
    ExecutorRuntimeID: runtimeID,
    ExecutorSessionID: threadID,
    ExecutorThreadID: threadID,
    ExecutorRootSessionID: rootSessionID,
    ExecutorTurnID: turnID,
    ExecutorToolUseID: toolUseID,
  }
}

function runHub(messages, env) {
  return new Promise((resolve) => {
    const child = spawn("node", [path.join(pluginRoot, "scripts/gv-mcp-hub.mjs")], {
      cwd: pluginRoot,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.on("exit", (status) => resolve({ status, stdout, stderr }))
    child.stdin.end(`${messages.map((message) => JSON.stringify(message)).join("\n")}\n`)
  })
}
