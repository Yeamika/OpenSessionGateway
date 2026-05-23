/**
 * CompactSession control command handler.
 *
 * Uses v2 SDK: client.session.summarize({ sessionID, directory, providerID, modelID, auto })
 */

import { type OpencodeClient } from "@opencode-ai/sdk/v2"
import { resolveTargetSessionContext } from "../runtime/target-context.js"

function readModel(value: string) {
  const text = value.trim()
  if (!text) return null
  const idx = text.indexOf("/")
  if (idx <= 0 || idx >= text.length - 1) return null
  const providerID = text.slice(0, idx).trim()
  const modelID = text.slice(idx + 1).trim()
  if (!providerID || !modelID) return null
  return { providerID, modelID }
}

export async function handleCompactSession(
  client: OpencodeClient,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const sessionID = typeof payload.sessionID === "string" ? payload.sessionID.trim() : ""
  const modelRaw = typeof payload.model === "string" ? payload.model.trim() : ""
  const auto = payload.auto === true

  if (!sessionID) {
    return { ok: false, sessionID: "", model: modelRaw, auto, error: "sessionID is required" }
  }

  const model = modelRaw ? readModel(modelRaw) : null
  if (modelRaw && !model) {
    return { ok: false, sessionID, model: modelRaw, auto, error: "model must be provider/model" }
  }

  const target = await resolveTargetSessionContext(client, sessionID)
  if (!target) {
    return { ok: false, sessionID, model: modelRaw, auto, error: "target session context not found" }
  }

  try {
    const result = await client.session.summarize({
      sessionID: target.sessionID,
      directory: target.instanceWorkspaceDirectory || undefined,
      providerID: model?.providerID,
      modelID: model?.modelID,
      auto,
    })
    return {
      ok: true,
      sessionID: target.sessionID,
      model: modelRaw,
      auto,
    }
  } catch (error) {
    return {
      ok: false,
      sessionID: target.sessionID,
      model: modelRaw,
      auto,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
