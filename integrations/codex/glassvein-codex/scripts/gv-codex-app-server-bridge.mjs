const DEFAULT_ROUTER_URL = "ws://127.0.0.1:7200"
const DEFAULT_RUNTIME_ID = "codex"
const DEFAULT_DOMAIN = "domain-a"

export async function startGvReceiver(readCaller) {
  if (!boolEnv("GV_CODEX_RECEIVE_ROUTER", true)) return
  if (!appServerUrl()) return

  const WebSocketImpl = await loadWebSocket()
  if (!WebSocketImpl) throw new Error("WebSocket is not available")

  while (true) {
    try {
      const caller = await readCaller()
      if (!caller.sessionID) {
        await sleep(1000)
        continue
      }
      await runGvReceiver(WebSocketImpl, caller)
    } catch (error) {
      console.error(`[gv-timer] receiver reconnecting: ${errorMessage(error)}`)
      await sleep(1000)
    }
  }
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
  await startCodexTurn(caller, prompt)
}

async function startCodexTurn(caller, prompt) {
  const client = await createWebSocketAppServerClient(appServerUrl())
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
    const threadId = await resolveThreadId(client, caller)
    await client.request("turn/start", {
      threadId,
      cwd: caller.cwd || process.cwd(),
      input: [{ type: "text", text: prompt }],
    })
  } finally {
    client.close()
  }
}

async function resolveThreadId(client, caller) {
  const existing = text(caller.threadID) || await readMappedThreadId(caller.sessionID)
  if (existing) return existing
  throw new Error(`No Codex app-server thread binding for session ${caller.sessionID}`)
}

async function readMappedThreadId(sessionID) {
  const session = text(sessionID)
  if (!session) return ""
  try {
    const raw = await import("node:fs/promises").then((fs) => fs.readFile(threadMapPath(), "utf8"))
    const map = JSON.parse(raw)
    return text(map[session])
  } catch {
    return ""
  }
}

async function createWebSocketAppServerClient(url) {
  if (url === "stdio://") {
    throw new Error("GV_CODEX_APP_SERVER_URL=stdio:// is not supported from the timer adapter; use ws://.")
  }
  const WebSocketImpl = await loadWebSocket()
  if (!WebSocketImpl) throw new Error("WebSocket is not available")

  let nextId = 1
  const pendingRequests = new Map()
  const ws = await new Promise((resolve, reject) => {
    const socket = new WebSocketImpl(url)
    once(socket, "open", () => resolve(socket))
    once(socket, "error", reject)
    on(socket, "message", (event) => {
      const raw = typeof event === "string" ? event : event?.data ?? event
      dispatchAppServerMessage(raw, pendingRequests)
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

function dispatchAppServerMessage(raw, pendingRequests) {
  const message = parseJson(raw)
  if (!message || message.id === undefined || message.id === null) return
  const pendingRequest = pendingRequests.get(message.id)
  if (!pendingRequest) return
  pendingRequests.delete(message.id)
  if (message.error) {
    pendingRequest.reject(new Error(message.error.message || JSON.stringify(message.error)))
  } else {
    pendingRequest.resolve(message.result)
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

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
