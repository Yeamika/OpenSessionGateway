import { createNewSessionRequest } from "@opensessiongateway/protocol-library/ws-protocol/CreateNewSession.js";

function readModel(value: string) {
  const text = value.trim()
  if (!text) return undefined
  const idx = text.indexOf("/")
  if (idx <= 0 || idx >= text.length - 1) return undefined
  const providerID = text.slice(0, idx).trim()
  const modelID = text.slice(idx + 1).trim()
  if (!providerID || !modelID) return undefined
  return { providerID, modelID }
}

function readSession(raw: unknown) {
  if (!raw || typeof raw !== "object") return undefined
  const src = raw as Record<string, unknown>
  const id = typeof src.id === "string" ? src.id.trim() : ""
  const title = typeof src.title === "string" ? src.title.trim() : ""
  if (!id || !title) return undefined
  const time = src.time && typeof src.time === "object" ? (src.time as Record<string, unknown>) : {}
  return {
    id,
    projectID: typeof src.projectID === "string" ? src.projectID.trim() || undefined : undefined,
    parentID: typeof src.parentID === "string" ? src.parentID.trim() || undefined : undefined,
    title,
    version: typeof src.version === "string" ? src.version.trim() || undefined : undefined,
    time: {
      created: typeof time.created === "number" ? time.created : undefined,
      updated: typeof time.updated === "number" ? time.updated : undefined,
      compacting: typeof time.compacting === "number" ? time.compacting : undefined,
    },
  }
}

function value<T>(raw: T | { data?: T } | null | undefined): T | null {
  if (!raw) return null
  if (typeof raw === "object" && "data" in raw) {
    const src = raw as { data?: T }
    return src.data ?? null
  }
  return raw as T
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function readPromptError(raw: unknown): string {
  if (!raw || typeof raw !== "object") return ""
  const src = raw as Record<string, unknown>
  const info = src.info && typeof src.info === "object" ? (src.info as Record<string, unknown>) : null
  const error = info?.error && typeof info.error === "object" ? (info.error as Record<string, unknown>) : null
  const name = typeof error?.name === "string" ? error.name.trim() : ""
  const data = error?.data && typeof error.data === "object" ? (error.data as Record<string, unknown>) : null
  const message = typeof data?.message === "string" ? data.message.trim() : ""
  if (name && message) return `${name}: ${message}`
  return message || name
}

function readSessionStatus(raw: unknown, sessionID: string): { type: string; message: string } {
  const src = value(raw)
  if (!src || typeof src !== "object") return { type: "", message: "" }
  const row = (src as Record<string, unknown>)[sessionID]
  if (!row || typeof row !== "object") return { type: "", message: "" }
  const status = row as Record<string, unknown>
  return {
    type: typeof status.type === "string" ? status.type.trim() : "",
    message: typeof status.message === "string" ? status.message.trim() : "",
  }
}

function readAssistantResult(raw: unknown, sessionID: string): { started: boolean; error: string } {
  const src = value(raw)
  if (!Array.isArray(src)) return { started: false, error: "" }
  for (const item of src) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const info = row.info && typeof row.info === "object" ? (row.info as Record<string, unknown>) : null
    if (!info) continue
    const role = typeof info.role === "string" ? info.role.trim() : ""
    const replySessionID = typeof info.sessionID === "string" ? info.sessionID.trim() : ""
    if (role !== "assistant" || replySessionID !== sessionID) continue
    return {
      started: true,
      error: readPromptError({ info }),
    }
  }
  return { started: false, error: "" }
}

async function waitForExecutionStart(ctx: any, sessionID: string, instanceWorkspaceDirectory: string): Promise<{ ok: boolean; error?: string }> {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    const statusResult = await ctx?.client?.session?.status?.({
      query: { directory: instanceWorkspaceDirectory },
    }).catch(() => null)
    const status = readSessionStatus(statusResult, sessionID)
    if (status.type === "busy") {
      return { ok: true }
    }
    if (status.type === "retry") {
      return { ok: false, error: status.message || "session entered retry state" }
    }

    const messagesResult = await ctx?.client?.session?.messages?.({
      path: { id: sessionID },
      query: { directory: instanceWorkspaceDirectory, limit: 8 },
    }).catch(() => null)
    const assistant = readAssistantResult(messagesResult, sessionID)
    if (assistant.started) {
      return assistant.error ? { ok: false, error: assistant.error } : { ok: true }
    }

    await sleep(150)
  }
  return { ok: false, error: "session did not start executing in time" }
}

export async function handleCreateNewSession(
  ctx: any,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const req = createNewSessionRequest(payload);
  if (!req.instanceWorkspaceDirectory) return { ok: false, sessionID: "", content: req.content, error: "instanceWorkspaceDirectory is required" };
  if (!req.content.trim()) {
    return { ok: false, sessionID: "", content: req.content, title: req.title, model: req.model, displayID: req.displayID, error: "content is required" };
  }
  const model = req.model ? readModel(req.model) : undefined
  if (req.model && !model) {
    return { ok: false, sessionID: "", content: req.content, title: req.title, model: req.model, displayID: req.displayID, error: "model must be provider/model" }
  }

  const created = await ctx?.client?.session?.create?.({
    query: { directory: req.instanceWorkspaceDirectory },
    body: req.title ? { title: req.title } : undefined,
  }).catch(() => null)

  const session = value(created)
  const sessionID = session && typeof session.id === "string" ? session.id.trim() : ""
  if (!sessionID) {
    return {
      ok: false,
      sessionID: "",
      content: req.content,
      title: req.title,
      model: req.model,
      displayID: req.displayID,
      error: "create session failed",
    }
  }

  const prompted = await ctx?.client?.session?.promptAsync?.({
    path: { id: sessionID },
    query: { directory: req.instanceWorkspaceDirectory },
    body: {
      parts: [{ type: "text", text: req.content }],
      ...(model ? { model } : {}),
    },
  }).then(() => true).catch(() => false)
  if (!prompted) {
    return {
      ok: false,
      sessionID,
      content: req.content,
      title: req.title,
      model: req.model,
      displayID: req.displayID,
      session: readSession(session),
      error: "submit initial content failed",
    }
  }

  const execution = await waitForExecutionStart(ctx, sessionID, req.instanceWorkspaceDirectory)
  if (!execution.ok) {
    return {
      ok: false,
      sessionID,
      content: req.content,
      title: req.title,
      model: req.model,
      displayID: req.displayID,
      session: readSession(session),
      error: execution.error || "session did not start executing",
    }
  }

  return {
    ok: true,
    sessionID,
    content: req.content,
    title: req.title,
    model: req.model,
    displayID: req.displayID,
    session: readSession(session),
  }
}
