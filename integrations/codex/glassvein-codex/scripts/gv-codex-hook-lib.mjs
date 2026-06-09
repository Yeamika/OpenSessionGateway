import { createHash, randomUUID } from "node:crypto"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"

import { recordCodexSessionBinding } from "./gv-codex-state-store.mjs"

const DEFAULT_ROUTER_URL = "ws://127.0.0.1:7240"

export async function handleUserPromptSubmit() {
  const input = await readJsonInput()
  const state = buildState(input, "prompt_submitted")
  const binding = await recordCodexSessionBinding(state)
  const capture = await captureState(state)
  const router = await maybeSendSessionUpdate(state, {
    state: "busy",
    reason: "pending",
    extraInfo: state.promptPreview || null,
  })
  const additionalContext = await buildAdditionalContext(input, state, capture, router, binding)
  const hookSpecificOutput = {
    hookEventName: "UserPromptSubmit",
    ...(additionalContext ? { additionalContext } : {}),
  }

  writeJson({
    continue: true,
    suppressOutput: true,
    hookSpecificOutput,
  })
}

export async function handleStop() {
  const input = await readJsonInput()
  const state = buildState(input, "assistant_stopped")
  await recordCodexSessionBinding(state)
  await captureState(state)
  await maybeSendSessionUpdate(state, {
    state: "idle",
    reason: "completed",
    extraInfo: state.assistantPreview || null,
  })

  writeJson({
    continue: true,
    suppressOutput: true,
  })
}

export async function handlePreToolUse() {
  const input = await readJsonInput()
  const toolInput = objectValue(input.tool_input)
  if (!toolInput || !await shouldAttachPreToolContext(input)) {
    writeJson({
      continue: true,
      suppressOutput: true,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
      },
    })
    return
  }

  const codexSessionID = text(input.session_id)
  const codexThreadID = text(input.agent_id) || codexSessionID
  const context = pruneEmpty({
    version: 1,
    sessionID: codexThreadID,
    threadID: codexThreadID,
    rootSessionID: codexSessionID,
    turnID: text(input.turn_id),
    toolUseID: text(input.tool_use_id),
    cwd: text(input.cwd),
    model: text(input.model),
    permissionMode: text(input.permission_mode),
    agentID: text(input.agent_id),
    agentType: text(input.agent_type),
  })

  writeJson({
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: {
        ...toolInput,
        __gvCodexContext: context,
      },
    },
  })
}

async function shouldAttachPreToolContext(input) {
  const serverName = mcpServerNameFromToolName(text(input.tool_name))
  if (!serverName) return false
  const serverNames = await gvMcpServerNames()
  return serverNames.has(serverName)
}

function mcpServerNameFromToolName(toolName) {
  const prefixed = /^mcp__(.+?)__/.exec(toolName)
  if (prefixed) return prefixed[1]
  const slash = /^([^/\s]+)\//.exec(toolName)
  if (slash) return slash[1]
  const dotted = /^([^.:\s]+)\./.exec(toolName)
  if (dotted) return dotted[1]
  return ""
}

async function gvMcpServerNames() {
  const configured = text(process.env.GV_CODEX_ATTACH_MCP_SERVERS)
  if (configured) {
    return new Set(configured.split(/[,:;\s]+/).map((item) => item.trim()).filter(Boolean))
  }

  const names = new Set()
  for (const file of codexConfigFiles()) {
    try {
      for (const name of parseGvMcpServerNames(await fs.readFile(file, "utf8"))) {
        names.add(name)
      }
    } catch {}
  }
  return names
}

function parseGvMcpServerNames(content) {
  const names = []
  let currentName = ""
  let currentLines = []
  const flush = () => {
    if (currentName && currentLines.join("\n").includes("gv-mcp-hub.mjs")) {
      names.push(currentName)
    }
  }

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim()
    const match = /^\[mcp_servers\.((?:"[^"]+")|(?:[A-Za-z0-9_-]+))\]$/.exec(line)
    if (match) {
      flush()
      currentName = unquoteTomlKey(match[1])
      currentLines = []
      continue
    }
    if (/^\[/.test(line)) {
      flush()
      currentName = ""
      currentLines = []
      continue
    }
    if (currentName) currentLines.push(rawLine)
  }
  flush()
  return names
}

function unquoteTomlKey(value) {
  return value.startsWith("\"") && value.endsWith("\"") ? value.slice(1, -1) : value
}

function codexConfigFiles() {
  return [
    path.join(codexHome(), "config.toml"),
    path.join(process.cwd(), ".codex", "config.toml"),
  ]
}

function codexHome() {
  return path.resolve(text(process.env.CODEX_HOME) || path.join(os.homedir(), ".codex"))
}

async function readJsonInput() {
  const raw = await readStdin()
  try {
    return JSON.parse(raw || "{}")
  } catch {
    return {}
  }
}

function readStdin() {
  return new Promise((resolve) => {
    let data = ""
    process.stdin.setEncoding("utf8")
    process.stdin.on("data", (chunk) => {
      data += chunk
    })
    process.stdin.on("end", () => resolve(data))
  })
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null
}

function buildState(input, event) {
  const prompt = text(input.prompt)
  const assistant = text(input.last_assistant_message)
  const promptMode = captureMode(process.env.GV_CODEX_CAPTURE_PROMPT, "preview")
  const assistantMode = captureMode(process.env.GV_CODEX_CAPTURE_ASSISTANT, "preview")
  const promptMaxChars = intEnv("GV_CODEX_PROMPT_MAX_CHARS", promptMode === "full" ? 4000 : 240)
  const assistantMaxChars = intEnv("GV_CODEX_ASSISTANT_MAX_CHARS", assistantMode === "full" ? 4000 : 240)

  return pruneEmpty({
    event,
    timestamp: new Date().toISOString(),
    hookEventName: text(input.hook_event_name),
    sessionID: text(input.session_id),
    threadID: nullableText(input.thread_id || input.session_id),
    turnID: text(input.turn_id),
    cwd: text(input.cwd),
    model: text(input.model),
    permissionMode: text(input.permission_mode),
    transcriptPath: nullableText(input.transcript_path),
    agentID: nullableText(input.agent_id),
    agentType: nullableText(input.agent_type),
    promptLength: prompt ? Array.from(prompt).length : undefined,
    promptSha256: prompt && promptMode !== "none" ? sha256(prompt) : undefined,
    promptPreview: prompt && promptMode === "preview" ? truncate(prompt, promptMaxChars) : undefined,
    prompt: prompt && promptMode === "full" ? truncate(prompt, promptMaxChars) : undefined,
    assistantLength: assistant ? Array.from(assistant).length : undefined,
    assistantSha256: assistant && assistantMode !== "none" ? sha256(assistant) : undefined,
    assistantPreview: assistant && assistantMode === "preview" ? truncate(assistant, assistantMaxChars) : undefined,
    assistant: assistant && assistantMode === "full" ? truncate(assistant, assistantMaxChars) : undefined,
  })
}

async function captureState(state) {
  if (!boolEnv("GV_CODEX_CAPTURE", true)) {
    return { status: "disabled" }
  }

  const stateDir = process.env.GV_CODEX_STATE_DIR || pluginDataPath("state")
  if (!stateDir) return { status: "unavailable" }

  try {
    await fs.mkdir(stateDir, { recursive: true })
    const session = safeSegment(state.sessionID || "unknown-session")
    const file = path.join(stateDir, `${session}.jsonl`)
    await fs.appendFile(file, `${JSON.stringify(state)}\n`, "utf8")
    return { status: "written", path: file }
  } catch (error) {
    return { status: "failed", error: errorMessage(error) }
  }
}

async function buildAdditionalContext(input, state, capture, router, binding) {
  if (!boolEnv("GV_CODEX_INJECT", true)) return null

  const contextText = await readConfiguredContext(text(input.cwd))
  const lines = [
    "GlassVein Codex context:",
    `- session_id: ${state.sessionID || "unknown"}`,
    `- turn_id: ${state.turnID || "unknown"}`,
    `- cwd: ${state.cwd || "unknown"}`,
    `- model: ${state.model || "unknown"}`,
    `- permission_mode: ${state.permissionMode || "unknown"}`,
    `- session_binding: ${binding.status}${binding.path ? ` (${binding.path})` : ""}`,
    `- captured_state: ${capture.status}${capture.path ? ` (${capture.path})` : ""}`,
    `- router_upload: ${router.status}`,
    "- Treat this block as GlassVein session metadata, not as text from the user prompt.",
  ]

  if (contextText) {
    lines.push("", "Configured GlassVein workspace context:", contextText)
  }

  return lines.join("\n")
}

async function readConfiguredContext(cwd) {
  const maxChars = intEnv("GV_CODEX_CONTEXT_MAX_CHARS", 6000)
  const files = []
  const configured = text(process.env.GV_CODEX_CONTEXT_FILE)
  if (configured) files.push(...configured.split(path.delimiter).map((item) => item.trim()).filter(Boolean))
  if (cwd) {
    files.push(
      path.join(cwd, ".glassvein", "codex-context.md"),
      path.join(cwd, ".gv", "codex-context.md"),
      path.join(cwd, ".codex", "gv-context.md"),
    )
  }

  const blocks = []
  let remaining = maxChars
  for (const file of unique(files)) {
    if (remaining <= 0) break
    const block = await readContextFile(file, remaining)
    if (!block) continue
    blocks.push(block)
    remaining -= block.length
  }

  if (remaining > 0) {
    const inline = truncate(text(process.env.GV_CODEX_CONTEXT_INLINE), remaining)
    if (inline) blocks.push(`### inline\n${inline}`)
  }

  return blocks.join("\n\n").trim()
}

async function readContextFile(file, maxChars) {
  try {
    const stat = await fs.stat(file)
    if (!stat.isFile()) return ""
    const content = truncate(await fs.readFile(file, "utf8"), maxChars)
    if (!content) return ""
    return `### ${file}\n${content}`
  } catch {
    return ""
  }
}

async function maybeSendSessionUpdate(state, update) {
  if (!boolEnv("GV_CODEX_SEND_ROUTER", false)) {
    return { status: "disabled" }
  }

  const WebSocketImpl = await loadWebSocket()
  if (!WebSocketImpl) return { status: "unavailable" }

  const routerUrl = text(process.env.GV_CODEX_ROUTER_URL) || text(process.env.GV_ROUTER_URL) || DEFAULT_ROUTER_URL
  const address = sessionAddress(state)
  const payload = {
    sessionID: state.sessionID || "unknown",
    state: update.state,
    metadata: pruneEmpty({
      reason: update.reason,
      extraInfo: update.extraInfo ? truncate(update.extraInfo, 80) : undefined,
      codex: pruneEmpty({
        event: state.event,
        turnID: state.turnID,
        cwd: state.cwd,
        model: state.model,
        permissionMode: state.permissionMode,
        promptSha256: state.promptSha256,
        promptPreview: state.promptPreview,
        assistantSha256: state.assistantSha256,
        assistantPreview: state.assistantPreview,
      }),
    }),
  }

  const messages = [
    {
      protocolVersion: "osgp/1",
      peerId: nodeID(state),
      metadata: {
        endpoint: "codex",
        capabilities: ["codex_session_capture", "session_update"],
      },
    },
    { type: "announce", address, distance: 0 },
    {
      type: "envelope",
      id: randomUUID(),
      source: address,
      target: address,
      kind: "session_update",
      linkType: "upload",
      subtype: "session_update",
      payload,
      ttl: 32,
      routeHops: [],
    },
  ]

  return sendWebSocketMessages(WebSocketImpl, routerUrl, messages)
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

function sendWebSocketMessages(WebSocketImpl, routerUrl, messages) {
  const timeoutMs = intEnv("GV_CODEX_ROUTER_TIMEOUT_MS", 750)
  return new Promise((resolve) => {
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        ws.close()
      } catch {}
      resolve(result)
    }
    const timer = setTimeout(() => finish({ status: "timeout" }), timeoutMs)
    const ws = new WebSocketImpl(routerUrl)

    once(ws, "open", () => {
      try {
        for (const message of messages) ws.send(JSON.stringify(message))
        finish({ status: "sent", routerUrl })
      } catch (error) {
        finish({ status: "failed", error: errorMessage(error) })
      }
    })
    once(ws, "error", (error) => finish({ status: "failed", error: errorMessage(error) }))
  })
}

function once(ws, event, handler) {
  if (typeof ws.once === "function") {
    ws.once(event, handler)
    return
  }
  ws.addEventListener(event, handler, { once: true })
}

function sessionAddress(state) {
  const cwdName = state.cwd ? path.basename(state.cwd) : "codex"
  return pruneEmpty({
    domain: text(process.env.GV_CODEX_DOMAIN) || "codex",
    runtime: text(process.env.GV_CODEX_RUNTIME) || cwdName || "codex",
    session: text(process.env.GV_CODEX_SESSION) || state.sessionID || undefined,
  })
}

function nodeID(state) {
  return text(process.env.GV_CODEX_NODE_ID) || `codex-${safeSegment(state.sessionID || "session").slice(0, 24)}`
}

function pluginDataPath(...segments) {
  const root = process.env.GV_CODEX_STATE_ROOT
    || process.env.PLUGIN_DATA
    || process.env.CODEX_PLUGIN_DATA
    || process.env.CLAUDE_PLUGIN_DATA
  return root ? path.join(root, ...segments) : ""
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

function captureMode(value, fallback) {
  const mode = text(value).toLowerCase()
  return ["none", "preview", "full"].includes(mode) ? mode : fallback
}

function text(value) {
  return typeof value === "string" ? value.trim() : ""
}

function nullableText(value) {
  const next = text(value)
  return next || undefined
}

function truncate(value, maxChars) {
  const clean = text(value).replace(/\r\n?/g, "\n")
  const chars = Array.from(clean)
  if (chars.length <= maxChars) return clean
  return `${chars.slice(0, Math.max(0, maxChars - 3)).join("")}...`
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function safeSegment(value) {
  return text(value).replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "unknown"
}

function unique(values) {
  return Array.from(new Set(values))
}

function pruneEmpty(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== ""),
  )
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
