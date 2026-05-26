import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createGlassveinClient, GlassveinWsClient } from "../dist/glassvein-router/glassvein-ws-client.js"

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

test("source address includes runtime for viewer display", () => {
  const client = createGlassveinClient(
    { directory: "/tmp/real-workspace" },
    { routerUrl: "ws://127.0.0.1:7200", domain: "opencode" },
  )
  assert.equal(client.getSourceAddress().domain, "opencode")
  assert.equal(client.getSourceAddress().runtime, "real-workspace")
})

test("upload session_update uses canonical OSGP envelope", () => {
  const { client, sent } = connectedClient()
  assert.equal(client.sendUploadEvent("session_update", { sessionId: "ses-1", state: "idle" }), true)
  assert.equal(sent[0].type, "envelope")
  assert.equal(sent[0].linkType, "upload")
  assert.equal(sent[0].subtype, "session_update")
  assert.equal(sent[0].source.runtime, "workspace-a")
  assert.equal(Object.hasOwn(sent[0], `ki${"n"}d`), false)
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
