import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { WebSocketServer } from "ws"
import { createGlassveinClient, GlassveinWsClient } from "../dist/glassvein-router/glassvein-ws-client.js"
import { createRouterLinkHandshake } from "../dist/glassvein-router/osgp-adapter.js"
import { buildInternalRouterArgs, ensureInternalRouterStateFile } from "../dist/opencode/runtime/internal-router.js"
import { applyOsgMcpConfig } from "../dist/opencode/runtime/mcp.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function connectedClient() {
  const sent = []
  const client = new GlassveinWsClient({
    routerUrl: "ws://127.0.0.1:7200",
    nodeId: "node-a",
    domain: "opencode",
    runtime: "workspace-a",
  })
  client.ws = { send: (text, cb) => { sent.push(JSON.parse(text)); if (cb) cb() } }
  client._state.status = "connected"
  return { client, sent }
}

function walk(dir, out = []) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, item.name)
    if (item.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

async function withEnv(values, fn) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]))
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    return await fn()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve()
      if (Date.now() >= deadline) return reject(new Error("timed out waiting for condition"))
      setTimeout(tick, 20)
    }
    tick()
  })
}

function internalRouterConfig(patch = {}) {
  return {
    enabled: true,
    nodeId: "opencode-gv-router",
    bindHost: "127.0.0.1",
    port: 7241,
    bindAddr: "127.0.0.1:7241",
    routerUrl: "ws://127.0.0.1:7241",
    upstreamUrls: ["ws://127.0.0.1:4090", "ws://127.0.0.1:4091"],
    binaryPath: "",
    startupTimeoutMs: 5000,
    stateFilePath: "/tmp/gv-router-state.json",
    trustedAnnouncePeers: ["workspace-a", "timer-endpoint", "mailbox-endpoint"],
    ...patch,
  }
}

test("source address includes runtime for viewer display", () => {
  const client = createGlassveinClient(
    { directory: "/tmp/real-workspace" },
    { routerUrl: "ws://127.0.0.1:7200", domain: "opencode" },
  )
  assert.equal(client.getSourceAddress().domain, "opencode")
  assert.equal(client.getSourceAddress().runtime, "real-workspace")
})

test("package root resolves to opencode server plugin entry", async () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
  const mod = await import("../dist/entry.js")
  assert.equal(pkg.main, "dist/entry.js")
  assert.equal(pkg.exports["."], "./dist/entry.js")
  assert.equal(pkg.exports["./server"], "./dist/entry.js")
  assert.equal(pkg.dependencies["@opensessiongateway/glassvein-router"], "^0.2.0")
  assert.equal(typeof mod.default.server, "function")
  assert.equal(mod.default.id, "@opensessiongateway/opencode-vein-plugin")
})

test("connected client can announce a session address", () => {
  const { client, sent } = connectedClient()
  assert.equal(client.sendAddressRegister({
    domain: "opencode",
    runtime: "workspace-a",
    session: "ses-1",
  }), true)
  assert.deepEqual(sent[0], {
    type: "announce",
    address: {
      domain: "opencode",
      runtime: "workspace-a",
      session: "ses-1",
    },
    distance: 0,
  })
})

test("connect sends LinkHandshake then runtime announce", async (t) => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 })
  await new Promise((resolve) => server.once("listening", resolve))
  const address = server.address()
  assert.equal(typeof address, "object")
  const messages = []
  server.on("connection", (ws) => {
    ws.on("message", (data) => {
      messages.push(JSON.parse(data.toString()))
    })
  })

  const client = new GlassveinWsClient({
    routerUrl: `ws://127.0.0.1:${address.port}`,
    nodeId: "node-a",
    domain: "opencode",
    runtime: "workspace-a",
  })
  t.after(() => {
    client.disconnect()
    server.close()
  })

  await client.connect()
  await waitFor(() => messages.length >= 2)
  assert.equal(messages[0].protocolVersion, "osgp/1")
  assert.equal(messages[0].peerId, "node-a")
  assert.deepEqual(messages[1], {
    type: "announce",
    address: {
      domain: "opencode",
      runtime: "workspace-a",
    },
    distance: 0,
  })
})

test("server-level internal router args include bind and upstreams", () => {
  const args = buildInternalRouterArgs(internalRouterConfig())
  assert.deepEqual(args, [
    "--node-id", "opencode-gv-router",
    "--bind-addr", "127.0.0.1:7241",
    "--upstream-url", "ws://127.0.0.1:4090",
    "--upstream-url", "ws://127.0.0.1:4091",
    "--state-file", "/tmp/gv-router-state.json",
  ])
})

test("internal router state file grants trusted announce peers", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gv-router-state-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const stateFilePath = path.join(dir, "router-state.json")
  fs.writeFileSync(stateFilePath, JSON.stringify({
    schema_version: 1,
    node_id: "existing-router",
    updated_at: "2026-01-01T00:00:00.000Z",
    route_revision: 7,
    rule_revision: 0,
    permission_revision: 0,
    manual_routes: [{ address: "opencode/existing", neighbor: "n1", distance: 0 }],
    rules: [],
    persistent_grants: [{ peer_id: "workspace-a", op: "announce_route", kind: "persist" }],
    audit_log: [],
  }, null, 2))

  ensureInternalRouterStateFile(internalRouterConfig({ stateFilePath }))
  const state = JSON.parse(fs.readFileSync(stateFilePath, "utf8"))
  assert.deepEqual(state.manual_routes, [{ address: "opencode/existing", neighbor: "n1", distance: 0 }])
  assert.deepEqual(
    state.persistent_grants.sort((a, b) => a.peer_id.localeCompare(b.peer_id)),
    [
      { peer_id: "mailbox-endpoint", op: "announce_route", kind: "persist" },
      { peer_id: "timer-endpoint", op: "announce_route", kind: "persist" },
      { peer_id: "workspace-a", op: "announce_route", kind: "persist" },
    ],
  )
})

test("opencode client handshake uses vNext LinkHandshake shape", () => {
  const handshake = createRouterLinkHandshake("workspace-a", {
    endpoint: "opencode",
    capabilities: ["session_update"],
  })
  assert.equal(handshake.protocolVersion, "osgp/1")
  assert.equal(handshake.peerId, "workspace-a")
  assert.deepEqual(handshake.metadata.capabilities, ["session_update"])
  assert.equal(Object.hasOwn(handshake, "nodeId"), false)
  assert.equal(Object.hasOwn(handshake, "role"), false)
  assert.equal(Object.hasOwn(handshake, "addresses"), false)
})

test("timer MCP env entry is managed and receives runtime query", async () => {
  await withEnv({
    GV_TIMER_MCP_URL: "http://127.0.0.1:8789",
    VEIN_TIMER_MCP_URL: undefined,
    OSG_TIMER_MCP_URL: undefined,
    GV_MAILBOX_MCP_URL: undefined,
    VEIN_MAILBOX_MCP_URL: undefined,
    OSG_MAILBOX_MCP_URL: undefined,
    GV_TIMER_MCP_ENABLED: undefined,
    VEIN_TIMER_MCP_ENABLED: undefined,
    OSG_TIMER_MCP_ENABLED: undefined,
  }, async () => {
    const cfg = {}
    const logs = []
    const result = await applyOsgMcpConfig(
      cfg,
      async (level, message, extra) => { logs.push({ level, message, extra }) },
      () => "gv-runtime",
      () => "/tmp/gv-workspace",
      () => "ws://127.0.0.1:7240",
    )

    assert.deepEqual(result.names, ["timer_scheduler"])
    assert.equal(result.discovered, true)
    assert.equal(logs.at(-1)?.message, "mcp config injected")
    assert.equal(cfg.mcp.timer_scheduler.type, "remote")
    assert.equal(cfg.mcp.timer_scheduler.enabled, true)
    assert.equal(cfg.mcp.timer_scheduler.oauth, false)

    const url = new URL(cfg.mcp.timer_scheduler.url)
    assert.equal(url.origin, "http://127.0.0.1:8789")
    assert.equal(url.pathname, "/mcp/timer_scheduler")
    assert.equal(url.searchParams.get("runtimeID"), "gv-runtime")
    assert.equal(url.searchParams.get("instanceWorkspaceDirectory"), "/tmp/gv-workspace")
    assert.deepEqual(result.metadata, [{
      name: "timer_scheduler",
      sourceID: "timer-endpoint",
      metadata: { sourceID: "timer-endpoint" },
    }])
  })
})

test("mailbox MCP env entry is managed and receives runtime query", async () => {
  await withEnv({
    GV_MAILBOX_MCP_URL: "http://127.0.0.1:7311",
    VEIN_MAILBOX_MCP_URL: undefined,
    OSG_MAILBOX_MCP_URL: undefined,
    GV_TIMER_MCP_URL: undefined,
    VEIN_TIMER_MCP_URL: undefined,
    OSG_TIMER_MCP_URL: undefined,
    GV_MAILBOX_MCP_ENABLED: undefined,
    VEIN_MAILBOX_MCP_ENABLED: undefined,
    OSG_MAILBOX_MCP_ENABLED: undefined,
  }, async () => {
    const cfg = {}
    const result = await applyOsgMcpConfig(
      cfg,
      async () => {},
      () => "gv-runtime",
      () => "/tmp/gv-workspace",
      () => "ws://127.0.0.1:7240",
    )

    assert.deepEqual(result.names, ["mailbox"])
    assert.equal(cfg.mcp.mailbox.type, "remote")
    assert.equal(cfg.mcp.mailbox.enabled, true)
    assert.equal(cfg.mcp.mailbox.oauth, false)

    const url = new URL(cfg.mcp.mailbox.url)
    assert.equal(url.origin, "http://127.0.0.1:7311")
    assert.equal(url.pathname, "/api/v2/mcp/mailbox")
    assert.equal(url.searchParams.get("runtimeID"), "gv-runtime")
    assert.equal(url.searchParams.get("instanceWorkspaceDirectory"), "/tmp/gv-workspace")
    assert.deepEqual(result.metadata, [{
      name: "mailbox",
      sourceID: "mailbox-endpoint",
      metadata: { sourceID: "mailbox-endpoint" },
    }])
  })
})

test("timer MCP env entry honors explicit disabled config", async () => {
  await withEnv({
    GV_TIMER_MCP_URL: "http://127.0.0.1:8789/mcp/timer_scheduler",
    VEIN_TIMER_MCP_URL: undefined,
    OSG_TIMER_MCP_URL: undefined,
    GV_MAILBOX_MCP_URL: undefined,
    VEIN_MAILBOX_MCP_URL: undefined,
    OSG_MAILBOX_MCP_URL: undefined,
  }, async () => {
    const cfg = { mcp: { timer_scheduler: { enabled: false } } }
    const result = await applyOsgMcpConfig(
      cfg,
      async () => {},
      () => "gv-runtime",
      () => "/tmp/gv-workspace",
      () => "ws://127.0.0.1:7240",
    )

    assert.deepEqual(result.names, [])
    assert.deepEqual(cfg.mcp, { timer_scheduler: { enabled: false } })
  })
})

test("timer MCP managed entry remains disabled when explicitly turned off", async () => {
  await withEnv({
    GV_TIMER_MCP_URL: "http://127.0.0.1:8789",
    VEIN_TIMER_MCP_URL: undefined,
    OSG_TIMER_MCP_URL: undefined,
  }, async () => {
    const cfg = {}
    await applyOsgMcpConfig(
      cfg,
      async () => {},
      () => "gv-runtime",
      () => "/tmp/gv-workspace",
      () => "ws://127.0.0.1:7240",
    )
    assert.equal(cfg.mcp.timer_scheduler.enabled, true)

    cfg.mcp.timer_scheduler.enabled = false
    const result = await applyOsgMcpConfig(
      cfg,
      async () => {},
      () => "gv-runtime",
      () => "/tmp/gv-workspace",
      () => "ws://127.0.0.1:7240",
    )

    assert.deepEqual(result.names, [])
    assert.equal(cfg.mcp.timer_scheduler.enabled, false)
  })
})

test("upload session_update uses canonical OSGP envelope", () => {
  const { client, sent } = connectedClient()
  assert.equal(client.sendUploadEvent("session_update", { sessionID: "ses-1", state: "idle" }), true)
  assert.equal(sent[0].type, "envelope")
  assert.equal(sent[0].linkType, "upload")
  assert.equal(sent[0].subtype, "session_update")
  assert.equal(sent[0].kind, "session_update")
  assert.equal(sent[0].source.runtime, "workspace-a")
  assert.equal(sent[0].payload.sessionID, "ses-1")
  assert.equal(Object.hasOwn(sent[0].payload, "sessionId"), false)
})

test("runtime_session_messages response targets original source", async () => {
  const { client, sent } = connectedClient()
  client.onRequest(async () => ({ list: [], realsize: 0 }))
  client.handleMessage(JSON.stringify({
    type: "envelope",
    id: "req-1",
    linkType: "request",
    subtype: "runtime_session_messages",
    source: { domain: "viewer", runtime: "viewer-rt" },
    target: { domain: "opencode", runtime: "workspace-a" },
    payload: { sessionId: "ses-1" },
    ttl: 32,
    routeHops: [],
  }))
  await new Promise((resolve) => setImmediate(resolve))
  const response = sent.at(-1)
  assert.equal(response.linkType, "response")
  assert.equal(response.subtype, "runtime_session_messages")
  assert.deepEqual(response.target, { domain: "viewer", runtime: "viewer-rt" })
  assert.equal(response.id, "req-1")
})

test("control add_prompt returns canonical response", async () => {
  const { client, sent } = connectedClient()
  client.onControlCommand(async (command) => ({ ok: true, subtype: command.subtype }))
  client.handleMessage(JSON.stringify({
    type: "envelope",
    id: "ctl-1",
    linkType: "control",
    subtype: "add_prompt",
    source: { domain: "control", runtime: "control-rt" },
    target: { domain: "opencode", runtime: "workspace-a" },
    payload: { text: "hello" },
    ttl: 32,
    routeHops: [],
  }))
  await new Promise((resolve) => setImmediate(resolve))
  const response = sent.at(-1)
  assert.equal(response.linkType, "response")
  assert.equal(response.subtype, "add_prompt")
  assert.deepEqual(response.target, { domain: "control", runtime: "control-rt" })
  assert.equal(response.payload.ok, true)
})

test("source tree does not contain forbidden surface id fields", () => {
  const forbidden = new RegExp(`surface${"I"}d|surface_${"i"}d`)
  for (const file of walk(path.join(root, "src")).filter((p) => p.endsWith(".ts"))) {
    const text = fs.readFileSync(file, "utf8")
    assert.equal(forbidden.test(text), false, file)
  }
})
