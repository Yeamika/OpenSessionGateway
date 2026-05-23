/**
 * AddPrompt control command handler.
 *
 * Uses v2 SDK: client.session.messages() + client.session.promptAsync()
 */

import { type OpencodeClient } from "@opencode-ai/sdk/v2"
import { resolveTargetSessionContext } from "../runtime/target-context.js"

type QueryFactory = () => Record<string, unknown>

type CurrentInfo = {
  sessionID?: string
}

const SOURCE_ID_METADATA_WARNING = "async prompt sourceID does not match loaded MCP metadata"

function readStringArg(src: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = src[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return ""
}

function readModel(
  value: string,
): { providerID: string; modelID: string } | undefined {
  const text = value.trim()
  if (!text) return undefined
  const idx = text.indexOf("/")
  if (idx <= 0 || idx >= text.length - 1) return undefined
  const providerID = text.slice(0, idx).trim()
  const modelID = text.slice(idx + 1).trim()
  if (!providerID || !modelID) return undefined
  return { providerID, modelID }
}

function readAgent(msg: unknown): string {
  if (!msg || typeof msg !== "object") return ""
  const src = msg as Record<string, unknown>
  const info = src.info && typeof src.info === "object" ? (src.info as Record<string, unknown>) : {}
  const agent = info.agent
  return typeof agent === "string" && agent.trim() ? agent.trim() : ""
}

async function readLastAgent(client: OpencodeClient, sessionID: string, directory: string): Promise<string> {
  try {
    const result = await client.session.messages({
      sessionID,
      directory,
      limit: 20,
    })
    const raw = result && typeof result === "object" && "data" in result
      ? (result as { data?: unknown }).data
      : result
    const messages = Array.isArray(raw) ? raw : []
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const agent = readAgent(messages[i])
      if (agent) return agent
    }
  } catch {
    // ignore
  }
  return ""
}

export async function handleAddPrompt(
  client: OpencodeClient,
  _query: QueryFactory,
  _getCurrentClientInfo: () => Promise<CurrentInfo>,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const sessionID = readStringArg(payload, ["sessionID"])
  const msg = readStringArg(payload, ["msg"])
  const modelRaw = readStringArg(payload, ["model"])
  const system = readStringArg(payload, ["system"])
  const sourceID = readStringArg(payload, ["sourceID"])

  if (!msg) {
    return {
      ok: false,
      error: "msg is required",
      model: modelRaw || null,
      sessionID: "",
    }
  }

  if (!sessionID) {
    return {
      ok: false,
      error: "sessionID is required",
      model: modelRaw || null,
      sessionID: "",
    }
  }

  const target = await resolveTargetSessionContext(client, sessionID)
  if (!target) {
    return {
      ok: false,
      error: "target session context not found",
      model: modelRaw || null,
      sessionID,
    }
  }

  const model = readModel(modelRaw)
  const body = {
    parts: [{ type: "text" as const, text: msg }],
    ...(system ? { system } : {}),
    ...(model ? { model } : {}),
  }

  const warning = sourceID ? SOURCE_ID_METADATA_WARNING : undefined
  const agent = await readLastAgent(client, target.sessionID, target.instanceWorkspaceDirectory)

  try {
    await client.session.promptAsync({
      sessionID: target.sessionID,
      directory: target.instanceWorkspaceDirectory || undefined,
      model: model ? { providerID: model.providerID, modelID: model.modelID } : undefined,
      agent: agent || undefined,
      ...body,
    })
    return {
      ok: true,
      model: modelRaw || null,
      sessionID: target.sessionID,
      ...(warning ? { warning } : {}),
    }
  } catch {
    return {
      ok: false,
      model: modelRaw || null,
      sessionID: target.sessionID,
      error: "prompt submit failed",
      ...(warning ? { warning } : {}),
    }
  }
}
