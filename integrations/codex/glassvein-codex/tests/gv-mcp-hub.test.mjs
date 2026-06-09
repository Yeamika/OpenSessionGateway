import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

test("GV MCP hub has no built-in backend tools", async () => {
  const result = await runHub([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  ], { GV_CODEX_RECEIVE_ROUTER: "0" })

  assert.equal(result.status, 0, result.stderr)
  const lines = result.stdout.trim().split("\n").map((line) => JSON.parse(line))
  assert.equal(lines[0].result.serverInfo.name, "gv-mcp")
  assert.deepEqual(lines[1].result.tools, [])
})

test("GV MCP hub selects one backend from a shared registry", async () => {
  const temp = mkdtempSync(path.join(tmpdir(), "gv-mcp-hub-"))
  try {
    const registryFile = path.join(temp, "registry.json")
    writeFileSync(registryFile, JSON.stringify({
      servers: {
        demo: {
          type: "http-jsonrpc",
          url: "http://127.0.0.1:1/mcp/demo",
          exposePrefix: false,
          tools: {
            ping: {
              target: "Ping",
              inputSchema: { type: "object", properties: {}, additionalProperties: false },
            },
          },
        },
        other: {
          type: "http-jsonrpc",
          url: "http://127.0.0.1:1/mcp/other",
          exposePrefix: false,
          tools: {
            pong: {
              target: "Pong",
              inputSchema: { type: "object", properties: {}, additionalProperties: false },
            },
          },
        },
      },
    }), "utf8")

    const dedicated = await runHub([
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    ], {
      GV_CODEX_RECEIVE_ROUTER: "0",
      GV_MCP_REGISTRY_FILE: registryFile,
      GV_MCP_SERVER_NAME: "demo",
    })
    assert.equal(dedicated.status, 0, dedicated.stderr)
    const dedicatedLines = dedicated.stdout.trim().split("\n").map((line) => JSON.parse(line))
    assert.deepEqual(dedicatedLines[0].result.tools.map((tool) => tool.name), ["ping"])

    const aggregate = await runHub([
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    ], {
      GV_CODEX_RECEIVE_ROUTER: "0",
      GV_MCP_REGISTRY_FILE: registryFile,
    })
    assert.equal(aggregate.status, 0, aggregate.stderr)
    const aggregateLines = aggregate.stdout.trim().split("\n").map((line) => JSON.parse(line))
    assert.deepEqual(aggregateLines[0].result.tools.map((tool) => tool.name), ["demo.ping", "other.pong"])
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test("GV MCP hub fails when selected backend is missing", async () => {
  const temp = mkdtempSync(path.join(tmpdir(), "gv-mcp-hub-"))
  try {
    const registryFile = path.join(temp, "registry.json")
    writeFileSync(registryFile, JSON.stringify({
      servers: {
        demo: {
          type: "http-jsonrpc",
          url: "http://127.0.0.1:1/mcp/demo",
          tools: {},
        },
      },
    }), "utf8")

    const result = await runHub([
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    ], {
      GV_CODEX_RECEIVE_ROUTER: "0",
      GV_MCP_REGISTRY_FILE: registryFile,
      GV_MCP_SERVER_NAME: "missing",
    })

    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /GV_MCP_SERVER_NAME=missing was not found/)
    assert.match(result.stderr, /Available servers: demo/)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test("GV MCP hub loads registry and injects Codex session fields", async () => {
  const temp = mkdtempSync(path.join(tmpdir(), "gv-mcp-hub-"))
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
        result: { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] },
      }))
    })
  })

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const port = server.address().port
    const registryFile = path.join(temp, "registry.json")
    writeFileSync(registryFile, JSON.stringify({
      servers: {
        demo: {
          type: "http-jsonrpc",
          url: `http://127.0.0.1:${port}/mcp/demo`,
          runtimeQueryParam: "runtimeID",
          inject: ["ExecutorRuntimeID", "ExecutorSessionID", "threadID", "cwd"],
          tools: {
            ping: {
              target: "Ping",
              description: "Ping demo backend.",
              inputSchema: {
                type: "object",
                properties: { message: { type: "string" } },
                required: ["message"],
                additionalProperties: false,
              },
            },
          },
        },
      },
    }), "utf8")
    writeFileSync(path.join(temp, "state.jsonl"), "", "utf8")

    const result = await runHub([
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "demo.ping",
          arguments: {
            message: "hello",
            __gvCodexContext: {
              sessionID: "thread-1",
              threadID: "thread-1",
              rootSessionID: "root-thread-1",
              runtimeID: "runtime-1",
              cwd: pluginRoot,
              turnID: "turn-1",
              toolUseID: "tool-use-1",
            },
          },
        },
      },
    ], {
      GV_CODEX_RECEIVE_ROUTER: "0",
      GV_MCP_REGISTRY_FILE: registryFile,
    })

    assert.equal(result.status, 0, result.stderr)
    const lines = result.stdout.trim().split("\n").map((line) => JSON.parse(line))
    assert.equal(lines[0].result.tools[0].name, "demo.ping")
    assert.equal(JSON.parse(lines[1].result.content[0].text).ok, true)
    assert.equal(seen[0].url, "/mcp/demo?runtimeID=runtime-1")
    assert.deepEqual(seen[0].body.params.arguments, {
      message: "hello",
      ExecutorRuntimeID: "runtime-1",
      ExecutorSessionID: "thread-1",
      threadID: "thread-1",
      cwd: pluginRoot,
    })
  } finally {
    server.close()
    rmSync(temp, { recursive: true, force: true })
  }
})

test("GV MCP hub accepts Codex native MCP thread metadata", async () => {
  const temp = mkdtempSync(path.join(tmpdir(), "gv-mcp-hub-meta-"))
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
          inject: ["ExecutorSessionID", "ExecutorThreadID", "ExecutorRootSessionID"],
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
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "demo.ping",
          arguments: { message: "native" },
          _meta: { threadId: "codex-thread-native" },
        },
      },
    ], {
      GV_CODEX_RECEIVE_ROUTER: "0",
      GV_MCP_REGISTRY_FILE: registryFile,
    })

    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).result.content[0].text, "ok")
    assert.deepEqual(seen[0].body.params.arguments, {
      message: "native",
      ExecutorSessionID: "codex-thread-native",
      ExecutorThreadID: "codex-thread-native",
      ExecutorRootSessionID: "codex-thread-native",
    })
  } finally {
    server.close()
    rmSync(temp, { recursive: true, force: true })
  }
})

test("GV MCP hub ignores Codex thread env without a captured binding", async () => {
  const temp = mkdtempSync(path.join(tmpdir(), "gv-mcp-hub-"))
  const seen = []
  const server = createServer((req, res) => {
    let raw = ""
    req.on("data", (chunk) => {
      raw += chunk
    })
    req.on("end", () => {
      seen.push(JSON.parse(raw))
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
    const port = server.address().port
    const registryFile = path.join(temp, "registry.json")
    writeFileSync(registryFile, JSON.stringify({
      servers: {
        demo: {
          type: "http-jsonrpc",
          url: `http://127.0.0.1:${port}/mcp/demo`,
          inject: ["ExecutorSessionID", "threadID"],
          tools: {
            ping: {
              target: "Ping",
              inputSchema: { type: "object", properties: {}, additionalProperties: false },
            },
          },
        },
      },
    }), "utf8")

    const result = await runHub([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "demo.ping", arguments: {} },
      },
    ], {
      GV_CODEX_RECEIVE_ROUTER: "0",
      GV_MCP_REGISTRY_FILE: registryFile,
      GV_CODEX_STATE_DB: path.join(temp, "missing-state.sqlite"),
      PLUGIN_DATA: path.join(temp, "missing-plugin-data"),
      CODEX_THREAD_ID: "thread-env-1",
      GV_CODEX_SESSION_ID: "",
      ExecutorSessionID: "",
    })

    assert.equal(result.status, 0, result.stderr)
    const lines = result.stdout.trim().split("\n").map((line) => JSON.parse(line))
    assert.match(lines[0].error.message, /No GV Codex tool context was attached/)
    assert.equal(seen.length, 0)
  } finally {
    server.close()
    rmSync(temp, { recursive: true, force: true })
  }
})

test("GV MCP hub does not resolve ownership from env or GV state binding", async () => {
  const temp = mkdtempSync(path.join(tmpdir(), "gv-mcp-hub-"))
  const seen = []
  const server = createServer((req, res) => {
    let raw = ""
    req.on("data", (chunk) => {
      raw += chunk
    })
    req.on("end", () => {
      seen.push(JSON.parse(raw))
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
    const port = server.address().port
    const registryFile = path.join(temp, "registry.json")
    const stateDb = path.join(temp, "state_5.sqlite")
    await writeBindingDb(stateDb, {
      threadID: "thread-db-1",
      sessionID: "session-db-1",
      runtimeID: "runtime-db-1",
      cwd: pluginRoot,
      source: "cli",
    })
    writeFileSync(registryFile, JSON.stringify({
      servers: {
        demo: {
          type: "http-jsonrpc",
          url: `http://127.0.0.1:${port}/mcp/demo`,
          inject: ["ExecutorRuntimeID", "ExecutorSessionID", "threadID", "cwd"],
          tools: {
            ping: {
              target: "Ping",
              inputSchema: { type: "object", properties: {}, additionalProperties: false },
            },
          },
        },
      },
    }), "utf8")

    const result = await runHub([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "demo.ping", arguments: {} },
      },
    ], {
      GV_CODEX_RECEIVE_ROUTER: "0",
      GV_MCP_REGISTRY_FILE: registryFile,
      GV_CODEX_STATE_DB: stateDb,
      CODEX_THREAD_ID: "wrong-env-thread",
      GV_CODEX_SESSION_ID: "session-db-1",
      CODEX_SESSION_ID: "session-db-1",
      ExecutorSessionID: "session-db-1",
    })

    assert.equal(result.status, 0, result.stderr)
    const lines = result.stdout.trim().split("\n").map((line) => JSON.parse(line))
    assert.match(lines[0].error.message, /No GV Codex tool context was attached/)
    assert.equal(seen.length, 0)
  } finally {
    server.close()
    rmSync(temp, { recursive: true, force: true })
  }
})

test("GV MCP hub does not infer ownership from Codex thread state", async () => {
  const temp = mkdtempSync(path.join(tmpdir(), "gv-mcp-hub-"))
  const seen = []
  const server = createServer((req, res) => {
    let raw = ""
    req.on("data", (chunk) => {
      raw += chunk
    })
    req.on("end", () => {
      seen.push(JSON.parse(raw))
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
    const port = server.address().port
    const registryFile = path.join(temp, "registry.json")
    const stateDb = path.join(temp, "state_5.sqlite")
    await writeThreadDb(stateDb, {
      threadID: "thread-state-1",
      cwd: pluginRoot,
      source: "cli",
    })
    writeFileSync(registryFile, JSON.stringify({
      servers: {
        demo: {
          type: "http-jsonrpc",
          url: `http://127.0.0.1:${port}/mcp/demo`,
          inject: ["ExecutorSessionID", "threadID", "cwd"],
          tools: {
            ping: {
              target: "Ping",
              inputSchema: { type: "object", properties: {}, additionalProperties: false },
            },
          },
        },
      },
    }), "utf8")

    const result = await runHub([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "demo.ping", arguments: {} },
      },
    ], {
      GV_CODEX_RECEIVE_ROUTER: "0",
      GV_MCP_REGISTRY_FILE: registryFile,
      GV_CODEX_STATE_DB: stateDb,
      GV_CODEX_SESSION_ID: "",
      CODEX_THREAD_ID: "wrong-env-thread",
      ExecutorSessionID: "",
    })

    assert.equal(result.status, 0, result.stderr)
    const lines = result.stdout.trim().split("\n").map((line) => JSON.parse(line))
    assert.match(lines[0].error.message, /No GV Codex tool context was attached/)
    assert.equal(seen.length, 0)
  } finally {
    server.close()
    rmSync(temp, { recursive: true, force: true })
  }
})

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

async function writeThreadDb(dbPath, thread) {
  const { DatabaseSync } = await import("node:sqlite")
  const db = new DatabaseSync(dbPath)
  try {
    db.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY NOT NULL,
        rollout_path TEXT NOT NULL,
        cwd TEXT NOT NULL,
        source TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      )
    `)
    db.prepare(`
      INSERT INTO threads (
        id,
        rollout_path,
        cwd,
        source,
        updated_at,
        updated_at_ms
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(thread.threadID, `/tmp/${thread.threadID}.jsonl`, thread.cwd, thread.source, 1, 1)
  } finally {
    db.close()
  }
}

async function writeBindingDb(dbPath, binding) {
  const { DatabaseSync } = await import("node:sqlite")
  const db = new DatabaseSync(dbPath)
  try {
    db.exec(`
      CREATE TABLE gv_session_bindings (
        thread_id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL,
        runtime_id TEXT,
        cwd TEXT,
        source TEXT,
        codex_rollout_path TEXT,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      )
    `)
    db.prepare(`
      INSERT INTO gv_session_bindings (
        thread_id,
        session_id,
        runtime_id,
        cwd,
        source,
        created_at_ms,
        updated_at_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(binding.threadID, binding.sessionID, binding.runtimeID, binding.cwd, binding.source || null, 1, 1)
  } finally {
    db.close()
  }
}
