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

export async function handleCreateNewSession(
  ctx: any,
  payload: Record<string, unknown>,
  waitForSessionExecutionStart: (sessionID: string) => Promise<{ ok: boolean; error?: string }>,
): Promise<Record<string, unknown>> {
  const req = createNewSessionRequest(payload);
  if (!req.instanceWorkspaceDirectory) return { ok: false, sessionID: "", content: req.content, error: "instanceWorkspaceDirectory is required" };
  if (!req.content.trim()) {
    return { ok: false, sessionID: "", content: req.content, title: req.title, model: req.model, error: "content is required" };
  }
  const model = req.model ? readModel(req.model) : undefined
  if (req.model && !model) {
    return { ok: false, sessionID: "", content: req.content, title: req.title, model: req.model, error: "model must be provider/model" }
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
      session: readSession(session),
      error: "submit initial content failed",
    }
  }

  const execution = await waitForSessionExecutionStart(sessionID)
  if (!execution.ok) {
    return {
      ok: false,
      sessionID,
      content: req.content,
      title: req.title,
      model: req.model,
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
    session: readSession(session),
  }
}
