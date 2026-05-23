/**
 * RenameSession control command handler.
 *
 * Uses v2 SDK: client.session.update({ sessionID, directory, title })
 */

import { type OpencodeClient } from "@opencode-ai/sdk/v2"
import { resolveTargetSessionContext } from "../runtime/target-context.js"

type QueryFactory = () => Record<string, unknown>

export async function handleRenameSession(
  client: OpencodeClient,
  _query: QueryFactory,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const sessionID = typeof payload.sessionID === "string" ? payload.sessionID.trim() : ""
  const title = typeof payload.title === "string" ? payload.title.trim() : ""

  if (!sessionID) return { ok: false, error: "sessionID is required" }
  if (!title) return { ok: false, error: "title is required" }

  const target = await resolveTargetSessionContext(client, sessionID)
  if (!target) return { ok: false, error: "target session context not found", sessionID, title }

  try {
    await client.session.update({
      sessionID: target.sessionID,
      directory: target.instanceWorkspaceDirectory || undefined,
      title,
    })
    return { ok: true, sessionID: target.sessionID, title }
  } catch (error) {
    return { ok: false, error: "rename failed", details: error instanceof Error ? error.message : String(error), sessionID, title }
  }
}
