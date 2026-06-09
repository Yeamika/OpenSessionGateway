import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import { resolveAppServerThreadId } from "../scripts/gv-codex-app-server-bridge.mjs"
import { dynamicToolsForAppServer, handleDynamicToolCall } from "../scripts/gv-codex-dynamic-tools.mjs"

test("app-server auto mode creates isolated Codex threads per GV session", async () => {
  const temp = mkdtempSync(path.join(tmpdir(), "gv-codex-app-server-"))
  const env = withThreadMap(temp)
  try {
    const client = fakeClient(["codex-thread-a", "codex-thread-b"])
    const callerA = caller("gv-session-a", "hook-thread-a")
    const callerB = caller("gv-session-b", "hook-thread-b")

    assert.equal(await resolveAppServerThreadId(client, callerA, { threadMode: "auto" }), "codex-thread-a")
    assert.equal(await resolveAppServerThreadId(client, callerB, { threadMode: "auto" }), "codex-thread-b")
    assert.equal(await resolveAppServerThreadId(client, callerA, { threadMode: "auto" }), "codex-thread-a")

    assert.deepEqual(client.requests.map((request) => request.method), [
      "thread/start",
      "thread/start",
      "thread/resume",
    ])
    assert.equal(client.requests[2].params.threadId, "codex-thread-a")
    assert.deepEqual(readThreadMap(env.threadMapFile), {
      "gv-session-a": "codex-thread-a",
      "gv-session-b": "codex-thread-b",
    })
  } finally {
    restoreEnv(env)
    rmSync(temp, { recursive: true, force: true })
  }
})

test("app-server existing mode does not create a missing Codex thread", async () => {
  const temp = mkdtempSync(path.join(tmpdir(), "gv-codex-app-server-"))
  const env = withThreadMap(temp)
  try {
    const client = fakeClient([])
    await assert.rejects(
      () => resolveAppServerThreadId(client, { sessionID: "gv-session" }, {}),
      /No Codex app-server thread binding/,
    )
    assert.deepEqual(client.requests, [])
  } finally {
    restoreEnv(env)
    rmSync(temp, { recursive: true, force: true })
  }
})

test("app-server resume mode resumes an explicit Codex thread", async () => {
  const temp = mkdtempSync(path.join(tmpdir(), "gv-codex-app-server-"))
  const env = withThreadMap(temp)
  try {
    const client = fakeClient(["ignored"])
    const threadID = await resolveAppServerThreadId(client, caller("gv-session", ""), {
      threadMode: "resume",
      threadId: "codex-existing",
      cwd: "/workspace/OSG-Project",
    })

    assert.equal(threadID, "codex-existing")
    assert.deepEqual(client.requests, [{
      method: "thread/resume",
      params: {
        threadId: "codex-existing",
        cwd: "/workspace/OSG-Project",
      },
    }])
  } finally {
    restoreEnv(env)
    rmSync(temp, { recursive: true, force: true })
  }
})

test("app-server fork mode stores the forked Codex thread binding", async () => {
  const temp = mkdtempSync(path.join(tmpdir(), "gv-codex-app-server-"))
  const env = withThreadMap(temp)
  try {
    const client = fakeClient(["codex-forked"])
    const threadID = await resolveAppServerThreadId(client, caller("gv-session", ""), {
      threadMode: "fork",
      sourceThreadId: "codex-source",
      model: "gpt-test",
      ephemeral: true,
    })

    assert.equal(threadID, "codex-forked")
    assert.deepEqual(client.requests, [{
      method: "thread/fork",
      params: {
        threadId: "codex-source",
        model: "gpt-test",
        ephemeral: true,
      },
    }])
    assert.deepEqual(readThreadMap(env.threadMapFile), {
      "gv-session": "codex-forked",
    })
  } finally {
    restoreEnv(env)
    rmSync(temp, { recursive: true, force: true })
  }
})

test("app-server dynamic tools hide GV injected backend fields", async () => {
  const temp = mkdtempSync(path.join(tmpdir(), "gv-codex-app-server-"))
  const env = withRegistry(temp, {
    servers: {
      demo: {
        type: "http-jsonrpc",
        url: "http://127.0.0.1:1/mcp/demo",
        inject: ["ExecutorSessionID", "ExecutorTurnID"],
        tools: {
          ping: {
            description: "Ping demo.",
            inputSchema: {
              type: "object",
              properties: {
                message: { type: "string" },
                ExecutorSessionID: { type: "string" },
                ExecutorTurnID: { type: "string" },
              },
              required: ["message", "ExecutorSessionID"],
              additionalProperties: false,
            },
          },
        },
      },
    },
  })
  try {
    const tools = await dynamicToolsForAppServer()
    assert.deepEqual(tools, [{
      namespace: "demo",
      name: "ping",
      description: "Ping demo.",
      inputSchema: {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
        additionalProperties: false,
      },
    }])
  } finally {
    restoreEnv(env)
    rmSync(temp, { recursive: true, force: true })
  }
})

test("app-server dynamic tools discover HTTP JSON-RPC backend tools", async () => {
  const temp = mkdtempSync(path.join(tmpdir(), "gv-codex-app-server-"))
  const seen = []
  const server = createServer((req, res) => {
    let raw = ""
    req.on("data", (chunk) => {
      raw += chunk
    })
    req.on("end", () => {
      const body = JSON.parse(raw)
      seen.push(body)
      res.setHeader("content-type", "application/json")
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          tools: [{
            name: "Ping",
            description: "Ping discovered.",
            inputSchema: {
              type: "object",
              properties: {
                message: { type: "string" },
                ExecutorSessionID: { type: "string" },
              },
              required: ["message", "ExecutorSessionID"],
              additionalProperties: false,
            },
          }],
        },
      }))
    })
  })

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const env = withRegistry(temp, {
    servers: {
      demo: {
        type: "http-jsonrpc",
        url: `http://127.0.0.1:${server.address().port}/mcp/demo`,
        inject: ["ExecutorSessionID"],
      },
    },
  })
  try {
    const tools = await dynamicToolsForAppServer()
    assert.deepEqual(tools, [{
      namespace: "demo",
      name: "Ping",
      description: "Ping discovered.",
      inputSchema: {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
        additionalProperties: false,
      },
    }])
    assert.equal(seen[0].method, "tools/list")
  } finally {
    server.close()
    restoreEnv(env)
    rmSync(temp, { recursive: true, force: true })
  }
})

test("app-server dynamic tool calls inject Codex thread ownership through GV hub", async () => {
  const temp = mkdtempSync(path.join(tmpdir(), "gv-codex-app-server-"))
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
        result: { content: [{ type: "text", text: "pong" }] },
      }))
    })
  })

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const env = withRegistry(temp, {
    servers: {
      demo: {
        type: "http-jsonrpc",
        url: `http://127.0.0.1:${server.address().port}/mcp/demo`,
        runtimeQueryParam: "runtimeID",
        inject: ["ExecutorRuntimeID", "ExecutorSessionID", "ExecutorThreadID", "ExecutorTurnID", "ExecutorToolUseID"],
        tools: {
          ping: {
            target: "Ping",
            inputSchema: { type: "object", properties: { message: { type: "string" } }, additionalProperties: false },
          },
        },
      },
    },
  })
  try {
    const result = await handleDynamicToolCall({
      threadId: "codex-thread-1",
      turnId: "codex-turn-1",
      callId: "codex-call-1",
      namespace: "demo",
      tool: "ping",
      arguments: { message: "hello" },
    }, {
      runtimeID: "runtime-a",
      cwd: "/workspace/OSG-Project",
    })

    assert.deepEqual(result, {
      contentItems: [{ type: "inputText", text: "pong" }],
      success: true,
    })
    assert.equal(seen[0].url, "/mcp/demo?runtimeID=runtime-a")
    assert.deepEqual(seen[0].body.params.arguments, {
      message: "hello",
      ExecutorRuntimeID: "runtime-a",
      ExecutorSessionID: "codex-thread-1",
      ExecutorThreadID: "codex-thread-1",
      ExecutorTurnID: "codex-turn-1",
      ExecutorToolUseID: "codex-call-1",
    })
  } finally {
    server.close()
    restoreEnv(env)
    rmSync(temp, { recursive: true, force: true })
  }
})

function caller(sessionID, threadID) {
  return { sessionID, threadID, cwd: "" }
}

function fakeClient(startedThreadIds) {
  const requests = []
  return {
    requests,
    async request(method, params) {
      requests.push({ method, params })
      if (method === "thread/resume") return { thread: { id: params.threadId } }
      if (method === "thread/fork") return { thread: { id: startedThreadIds.shift() } }
      if (method === "thread/start") return { thread: { id: startedThreadIds.shift() } }
      throw new Error(`unexpected method: ${method}`)
    },
  }
}

function withThreadMap(temp) {
  const previous = {
    GV_CODEX_THREAD_MAP_FILE: process.env.GV_CODEX_THREAD_MAP_FILE,
    GV_CODEX_APP_THREAD_MODE: process.env.GV_CODEX_APP_THREAD_MODE,
  }
  const threadMapFile = path.join(temp, "threads.json")
  process.env.GV_CODEX_THREAD_MAP_FILE = threadMapFile
  delete process.env.GV_CODEX_APP_THREAD_MODE
  return { previous, threadMapFile }
}

function withRegistry(temp, registry) {
  const previous = {
    GV_MCP_REGISTRY_FILE: process.env.GV_MCP_REGISTRY_FILE,
    GV_CODEX_DYNAMIC_MCP_SERVERS: process.env.GV_CODEX_DYNAMIC_MCP_SERVERS,
    GV_CODEX_APP_DYNAMIC_TOOLS: process.env.GV_CODEX_APP_DYNAMIC_TOOLS,
  }
  const registryFile = path.join(temp, "registry.json")
  process.env.GV_MCP_REGISTRY_FILE = registryFile
  process.env.GV_CODEX_DYNAMIC_MCP_SERVERS = Object.keys(registry.servers || {}).join(",")
  delete process.env.GV_CODEX_APP_DYNAMIC_TOOLS
  writeJson(registryFile, registry)
  return { previous }
}

function restoreEnv(env) {
  for (const [name, value] of Object.entries(env.previous)) restoreEnvValue(name, value)
}

function restoreEnvValue(name, value) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

function readThreadMap(file) {
  return JSON.parse(readFileSync(file, "utf8"))
}

function writeJson(file, value) {
  writeFileSync(file, JSON.stringify(value), "utf8")
}
