/**
 * CreateNewSession control command handler.
 *
 * Uses v2 SDK: client.session.create() + client.session.promptAsync()
 */

import { type OpencodeClient } from "@opencode-ai/sdk/v2"

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
  client: OpencodeClient,
  payload: Record<string, unknown>,
  waitForSessionExecutionStart: (sessionID: string) => Promise<{ ok: boolean; error?: string }>,
): Promise<Record<string, unknown>> {
  const instanceWorkspaceDirectory = typeof payload.instanceWorkspaceDirectory === "string"
    ? payload.instanceWorkspaceDirectory.trim()
    : ""
  const content = typeof payload.content === "string" ? payload.content.trim() : ""
  const title = typeof payload.title === "string" ? payload.title.trim() : ""
  const modelRaw = typeof payload.model === "string" ? payload.model.trim() : ""
  const agent = typeof payload.agent === "string" ? payload.agent.trim() : ""

  if (!instanceWorkspaceDirectory) {
    return { ok: false, sessionID: "", content, error: "instanceWorkspaceDirectory is required" }
  }
  if (!content) {
    return { ok: false, sessionID: "", content, title, model: modelRaw, error: "content is required" }
  }

  const model = modelRaw ? readModel(modelRaw) : undefined
  if (modelRaw && !model) {
    return { ok: false, sessionID: "", content, title, model: modelRaw, error: "model must be provider/model" }
  }

  let sessionID = ""
  let sessionData: unknown

  try {
    const created = await client.session.create({
      directory: instanceWorkspaceDirectory,
      title: title || undefined,
    })
    const session = value(created)
    sessionData = session
    sessionID = session && typeof (session as Record<string, unknown>).id === "string"
      ? ((session as Record<string, unknown>).id as string).trim()
      : ""
  } catch (error) {
    return {
      ok: false,
      sessionID: "",
      content,
      title,
      model: modelRaw,
      error: error instanceof Error ? error.message : String(error),
    }
  }

  if (!sessionID) {
    return {
      ok: false,
      sessionID: "",
      content,
      title,
      model: modelRaw,
      error: "create session failed",
    }
  }

  try {
    await client.session.promptAsync({
      sessionID,
      directory: instanceWorkspaceDirectory,
      model: model ? { providerID: model.providerID, modelID: model.modelID } : undefined,
      parts: [{ type: "text" as const, text: content }],
    })
  } catch (error) {
    return {
      ok: false,
      sessionID,
      content,
      title,
      model: modelRaw,
      agent,
      session: readSession(sessionData),
      error: `submit initial content failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  const execution = await waitForSessionExecutionStart(sessionID)
  if (!execution.ok) {
    return {
      ok: false,
      sessionID,
      content,
      title,
      model: modelRaw,
      agent,
      session: readSession(sessionData),
      error: execution.error || "session did not start executing",
    }
  }

  return {
    ok: true,
    sessionID,
    content,
    title,
    model: modelRaw,
    agent,
    session: readSession(sessionData),
  }
}
