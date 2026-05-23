/**
 * AbortSession control command handler.
 *
 * Uses v2 SDK: client.session.abort({ sessionID, directory })
 */

import { type OpencodeClient } from "@opencode-ai/sdk/v2"
import { resolveTargetSessionContext } from "../runtime/target-context.js"

type QueryFactory = () => Record<string, unknown>

export async function handleAbortSession(
  client: OpencodeClient,
  _query: QueryFactory,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const sessionID = typeof payload.sessionID === "string" ? payload.sessionID.trim() : ""
  if (!sessionID) return { ok: false, aborted: false, sessionID: "", error: "sessionID is required" }

  const target = await resolveTargetSessionContext(client, sessionID)
  if (!target) {
    return { ok: false, aborted: false, sessionID, error: "target session context not found" }
  }

  try {
    const result = await client.session.abort({
      sessionID: target.sessionID,
      directory: target.instanceWorkspaceDirectory || undefined,
    })
    return {
      ok: true,
      aborted: result.data === true,
      sessionID: target.sessionID,
    }
  } catch (error) {
    return {
      ok: false,
      aborted: false,
      sessionID,
      error: "abort failed",
      details: error instanceof Error ? error.message : String(error),
    }
  }
}
