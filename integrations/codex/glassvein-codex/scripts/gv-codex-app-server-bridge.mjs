import { promises as fs } from "node:fs"

import { dynamicToolsForAppServer, handleDynamicToolCall } from "./gv-codex-dynamic-tools.mjs"

const DEFAULT_ROUTER_URL = "ws://127.0.0.1:7200"
const DEFAULT_RUNTIME_ID = "codex"
const DEFAULT_DOMAIN = "domain-a"
const receiverSessions = new Set()
const APP_THREAD_MODES = new Set(["existing", "auto", "start", "resume", "fork"])

export async function startGvReceiver(readCaller) {
  if (!boolEnv("GV_CODEX_RECEIVE_ROUTER", true)) return
  if (!appServerUrl()) return

  while (true) {
    try {
      const caller = await readCaller()
      if (caller.sessionID) ensureReceiverForCaller(caller)
      await sleep(1000)
    } catch (error) {
      console.error(`[gv-timer] receiver reconnecting: ${errorMessage(error)}`)
      await sleep(1000)
    }
  }
}

export function ensureReceiverForCaller(caller) {
  if (!boolEnv("GV_CODEX_RECEIVE_ROUTER", true)) return { status: "disabled" }
  if (!appServerUrl()) return { status: "no_app_server" }
  if (!text(caller?.sessionID)) return { status: "missing_session" }

  const key = `${caller.runtimeID || DEFAULT_RUNTIME_ID}:${caller.sessionID}`
  if (receiverSessions.has(key)) return { status: "running" }
  receiverSessions.add(key)
  runManagedGvReceiver(caller, key).catch((error) => {
    receiverSessions.delete(key)
    console.error(`[gv-timer] receiver stopped: ${errorMessage(error)}`)
  })
  return { status: "started" }
}

export async function ensureRouteForCaller(caller) {
  if (appServerUrl()) return
  if (!boolEnv("GV_CODEX_ANNOUNCE_ON_TOOL", true)) return
  const WebSocketImpl = await loadWebSocket()
  if (!WebSocketImpl) return
  await new Promise((resolve) => {
    const ws = new WebSocketImpl(routerUrl())
    const done = () => {
      try {
        ws.close()
      } catch {}
      resolve()
    }
    const timer = setTimeout(done, 1000)
    once(ws, "open", () => {
      clearTimeout(timer)
      sendJson(ws, handshake(caller))
      sendJson(ws, announce(caller))
      setTimeout(done, 80)
    })
    once(ws, "error", done)
  })
}

async function runManagedGvReceiver(caller, key) {
  const WebSocketImpl = await loadWebSocket()
  if (!WebSocketImpl) throw new Error("WebSocket is not available")

  while (receiverSessions.has(key)) {
    try {
      await runGvReceiver(WebSocketImpl, caller)
    } catch (error) {
      console.error(`[gv-timer] receiver reconnecting: ${errorMessage(error)}`)
      await sleep(1000)
    }
  }
}

async function runGvReceiver(WebSocketImpl, caller) {
  await new Promise((resolve, reject) => {
    const ws = new WebSocketImpl(routerUrl())
    once(ws, "open", () => {
      sendJson(ws, handshake(caller))
      sendJson(ws, announce(caller))
    })
    on(ws, "message", (event) => {
      const raw = typeof event === "string" ? event : event?.data ?? event
      handleGvMessage(raw, caller).catch((error) => {
        console.error(`[gv-timer] failed to start Codex turn: ${errorMessage(error)}`)
      })
    })
    once(ws, "close", resolve)
    once(ws, "error", reject)
  })
}

async function handleGvMessage(raw, caller) {
  const message = parseJson(raw)
  if (!message || message.type !== "envelope") return
  if (message.linkType !== "control" || message.subtype !== "add_prompt") return
  const payload = message.payload && typeof message.payload === "object" ? message.payload : {}
  const prompt = timerPrompt(payload, message)
  if (!prompt) return
  await startCodexTurn(caller, prompt, payload)
}

export async function startCodexTurn(caller, prompt, payload = {}) {
  const client = await createWebSocketAppServerClient(appServerUrl(), { caller })
  try {
    await client.request("initialize", {
      clientInfo: {
        name: "glassvein_codex",
        title: "GlassVein Codex",
        version: "0.1.0",
      },
      capabilities: { experimentalApi: true },
    })
    client.notify("initialized", {})
    const threadId = await resolveAppServerThreadId(client, caller, payload)
    const turn = await client.request("turn/start", {
      threadId,
      cwd: appServerCwd(caller, payload) || process.cwd(),
      input: [{ type: "text", text: prompt }],
    })
    await client.waitForTurnCompletion(turn?.turn?.id)
  } finally {
    client.close()
  }
}

export async function resolveAppServerThreadId(client, caller, payload = {}) {
  const mode = appThreadMode(payload)
  if (mode === "start") return await startAppThread(client, caller, payload)

  const mappedOrExplicit = await mappedOrExplicitThreadId(caller, payload)
  if (mode === "auto") {
    if (mappedOrExplicit) return await resumeAppThread(client, caller, payload, mappedOrExplicit)
    return await startAppThread(client, caller, payload)
  }

  const existing = mappedOrExplicit || text(caller.threadID)
  if (mode === "resume") return await resumeAppThread(client, caller, payload, existing)
  if (mode === "fork") return await forkAppThread(client, caller, payload, existing)
  if (existing) return existing
  throw new Error(`No Codex app-server thread binding for session ${caller.sessionID}`)
}

async function startAppThread(client, caller, payload) {
  const result = await client.request("thread/start", await threadParams(caller, payload, {
    dynamicTools: true,
    ephemeral: true,
  }))
  const threadId = responseThreadId(result, "thread/start")
  await writeMappedThreadId(caller.sessionID, threadId)
  return threadId
}

async function resumeAppThread(client, caller, payload, threadId) {
  const target = text(threadId)
  if (!target) throw new Error(`No Codex app-server thread binding for session ${caller.sessionID}`)
  const result = await client.request("thread/resume", {
    threadId: target,
    ...await threadParams(caller, payload),
  })
  const resolved = responseThreadId(result, "thread/resume") || target
  await writeMappedThreadId(caller.sessionID, resolved)
  return resolved
}

async function forkAppThread(client, caller, payload, threadId) {
  const source = text(payload.sourceThreadId || payload.source_thread_id || payload.fromThreadId || payload.from_thread_id) || text(threadId)
  if (!source) throw new Error(`No Codex app-server thread binding to fork for session ${caller.sessionID}`)
  const result = await client.request("thread/fork", {
    threadId: source,
    ...await threadParams(caller, payload, { ephemeral: true }),
  })
  const forked = responseThreadId(result, "thread/fork")
  await writeMappedThreadId(caller.sessionID, forked)
  return forked
}

async function mappedOrExplicitThreadId(caller, payload) {
  return explicitThreadId(payload) || await readMappedThreadId(caller.sessionID)
}

function explicitThreadId(payload) {
  return text(payload.codexThreadId || payload.codexThreadID || payload.threadId || payload.thread_id || payload.appServerThreadId || payload.app_server_thread_id)
}

function appThreadMode(payload) {
  const requested = text(payload.codexThreadMode || payload.threadMode || payload.thread_mode || process.env.GV_CODEX_APP_THREAD_MODE)
  return APP_THREAD_MODES.has(requested) ? requested : "existing"
}

async function threadParams(caller, payload, options = {}) {
  const params = {
    cwd: appServerCwd(caller, payload),
    model: text(payload.codexModel || payload.model),
    modelProvider: text(payload.codexModelProvider || payload.modelProvider || payload.model_provider),
    baseInstructions: text(payload.baseInstructions || payload.base_instructions),
    developerInstructions: text(payload.developerInstructions || payload.developer_instructions),
  }
  if (options.dynamicTools) params.dynamicTools = await dynamicToolsForAppServer()
  if (options.ephemeral) params.ephemeral = booleanValue(payload.ephemeral)
  return clean(params)
}

function appServerCwd(caller, payload) {
  return text(payload.codexCwd || payload.cwd) || text(caller.cwd)
}

function responseThreadId(result, method) {
  const threadId = text(result?.thread?.id || result?.threadId || result?.thread_id)
  if (!threadId) throw new Error(`${method} response did not include a thread id`)
  return threadId
}

async function readMappedThreadId(sessionID) {
  const session = text(sessionID)
  if (!session) return ""
  try {
    const raw = await fs.readFile(threadMapPath(), "utf8")
    const map = JSON.parse(raw)
    return text(map[session])
  } catch {
    return ""
  }
}

async function writeMappedThreadId(sessionID, threadID) {
  const session = text(sessionID)
  const thread = text(threadID)
  if (!session || !thread) return
  const file = threadMapPath()
  let map = {}
  try {
    map = JSON.parse(await fs.readFile(file, "utf8"))
  } catch {}
  map[session] = thread
  await fs.mkdir(pathDirname(file), { recursive: true })
  await fs.writeFile(file, `${JSON.stringify(map, null, 2)}\n`, "utf8")
}

async function createWebSocketAppServerClient(url, { caller = {} } = {}) {
  if (url === "stdio://") {
    throw new Error("GV_CODEX_APP_SERVER_URL=stdio:// is not supported from the timer adapter; use ws://.")
  }
  const WebSocketImpl = await loadWebSocket()
  if (!WebSocketImpl) throw new Error("WebSocket is not available")

  let nextId = 1
  const pendingRequests = new Map()
  const turnWaiters = new Map()
  const ws = await new Promise((resolve, reject) => {
    const socket = new WebSocketImpl(url)
    once(socket, "open", () => resolve(socket))
    once(socket, "error", reject)
    on(socket, "message", (event) => {
      const raw = typeof event === "string" ? event : event?.data ?? event
      dispatchAppServerMessage(raw, {
        pendingRequests,
        turnWaiters,
        caller,
        ws: socket,
      })
    })
  })

  return {
    request(method, params) {
      const id = nextId++
      sendJson(ws, { method, id, params })
      return waitForAppServerResponse(id, pendingRequests)
    },
    notify(method, params) {
      sendJson(ws, { method, params })
    },
    waitForTurnCompletion(turnID) {
      const id = text(turnID)
      if (!id) return Promise.resolve()
      const timeoutMs = intEnv("GV_CODEX_APP_SERVER_TURN_TIMEOUT_MS", 600000)
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          turnWaiters.delete(id)
          reject(new Error(`app-server turn ${id} timed out`))
        }, timeoutMs)
        turnWaiters.set(id, {
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
    },
    close() {
      try {
        ws.close()
      } catch {}
    },
  }
}

function address(caller) {
  return {
    domain: text(process.env.GV_CODEX_DOMAIN) || DEFAULT_DOMAIN,
    runtime: caller.runtimeID || DEFAULT_RUNTIME_ID,
    session: caller.sessionID,
  }
}

function handshake(caller) {
  return {
    protocolVersion: "osgp/1",
    peerId: nodeID(caller),
    metadata: {
      endpoint: "codex",
      capabilities: ["codex_timer_receiver", "control.add_prompt"],
    },
  }
}

function announce(caller) {
  return { type: "announce", address: address(caller), distance: 0 }
}

function nodeID(caller) {
  return text(process.env.GV_CODEX_NODE_ID) || `codex-${safeSegment(caller.sessionID).slice(0, 24)}`
}

function timerPrompt(payload, envelope) {
  const msg = text(payload.msg)
  const system = text(payload.system)
  if (system) return `${system}\n\n${msg || "Timer fired."}`.trim()
  if (msg) return msg
  return text(envelope?.payload?.text)
}

function dispatchAppServerMessage(raw, state) {
  const message = parseJson(raw)
  if (!message) return

  if (message.id !== undefined && message.id !== null && state.pendingRequests.has(message.id)) {
    const pendingRequest = state.pendingRequests.get(message.id)
    state.pendingRequests.delete(message.id)
    if (message.error) {
      pendingRequest.reject(new Error(message.error.message || JSON.stringify(message.error)))
    } else {
      pendingRequest.resolve(message.result)
    }
    return
  }

  if (message.method === "item/tool/call" && message.id !== undefined && message.id !== null) {
    handleDynamicToolCall(message.params || {}, state.caller).then(
      (result) => sendJson(state.ws, { id: message.id, result }),
      (error) => sendJson(state.ws, {
        id: message.id,
        error: { code: -32603, message: errorMessage(error) },
      }),
    )
    return
  }

  const turnID = text(message.params?.turn?.id || message.params?.turnId || message.params?.turn_id)
  if (turnID && state.turnWaiters.has(turnID) && /turn\/(completed|failed|cancelled)/.test(text(message.method))) {
    const waiter = state.turnWaiters.get(turnID)
    state.turnWaiters.delete(turnID)
    if (message.method === "turn/completed") waiter.resolve(message.params)
    else waiter.reject(new Error(`app-server ${message.method}`))
  }
}

function waitForAppServerResponse(id, pendingRequests) {
  const timeoutMs = intEnv("GV_CODEX_APP_SERVER_TIMEOUT_MS", 30000)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id)
      reject(new Error(`app-server request ${id} timed out`))
    }, timeoutMs)
    pendingRequests.set(id, {
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

async function loadWebSocket() {
  if (typeof globalThis.WebSocket === "function") return globalThis.WebSocket
  try {
    const mod = await import("ws")
    return mod.default || mod.WebSocket || null
  } catch {
    return null
  }
}

function routerUrl() {
  return text(process.env.GV_CODEX_ROUTER_URL || process.env.GV_ROUTER_URL) || DEFAULT_ROUTER_URL
}

function appServerUrl() {
  return text(process.env.GV_CODEX_APP_SERVER_URL)
}

function threadMapPath() {
  const configured = text(process.env.GV_CODEX_THREAD_MAP_FILE)
  if (configured) return configured
  const stateRoot = text(process.env.GV_CODEX_STATE_ROOT)
    || text(process.env.PLUGIN_DATA)
    || text(process.env.CODEX_PLUGIN_DATA)
    || text(process.env.CLAUDE_PLUGIN_DATA)
  return stateRoot ? `${stateRoot}/app-server-threads.json` : "/tmp/gv-codex-app-server-threads.json"
}

function sendJson(ws, value) {
  ws.send(JSON.stringify(value))
}

function once(ws, event, handler) {
  if (typeof ws.once === "function") return ws.once(event, handler)
  ws.addEventListener(event, handler, { once: true })
}

function on(ws, event, handler) {
  if (typeof ws.on === "function") return ws.on(event, handler)
  ws.addEventListener(event, handler)
}

function parseJson(raw) {
  try {
    const textValue = raw instanceof Buffer ? raw.toString("utf8") : String(raw)
    return JSON.parse(textValue)
  } catch {
    return null
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function text(value) {
  return typeof value === "string" ? value.trim() : ""
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

function safeSegment(value) {
  return text(value).replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "unknown"
}

function booleanValue(value) {
  if (typeof value === "boolean") return value
  return undefined
}

function clean(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ""))
}

function pathDirname(file) {
  const index = file.lastIndexOf("/")
  return index > 0 ? file.slice(0, index) : "."
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
