/**
 * Refresh session title — fetches session title from v2 opencode SDK.
 *
 * Uses v2 SDK: client.session.get({ sessionID, directory })
 */

import { type OpencodeClient } from "@opencode-ai/sdk/v2"

function readTitle(value: unknown): string {
  if (!value || typeof value !== "object") return ""
  const src = value as Record<string, unknown>
  const title = typeof src.title === "string" ? src.title.trim() : ""
  if (title) return title
  const info = src.info && typeof src.info === "object" ? (src.info as Record<string, unknown>) : {}
  const infoTitle = typeof info.title === "string" ? info.title.trim() : ""
  if (infoTitle) return infoTitle
  const session = src.session && typeof src.session === "object" ? (src.session as Record<string, unknown>) : {}
  return typeof session.title === "string" ? session.title.trim() : ""
}

export async function refreshSessionTitle(
  client: OpencodeClient,
  _query: () => Record<string, unknown>,
  sessionID: string,
  directory?: string,
): Promise<string> {
  const cleanSessionID = typeof sessionID === "string" ? sessionID.trim() : ""
  if (!cleanSessionID) return ""

  const cleanDirectory = typeof directory === "string" && directory.trim() ? directory.trim() : undefined
  try {
    const result = await client.session.get({
      sessionID: cleanSessionID,
      directory: cleanDirectory,
    })
    const data = result && typeof result === "object" && "data" in result
      ? (result as { data?: unknown }).data
      : result
    return readTitle(data)
  } catch {
    return ""
  }
}
