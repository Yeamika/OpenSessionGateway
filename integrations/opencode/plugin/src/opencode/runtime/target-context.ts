/**
 * Target session context resolution for control commands.
 *
 * Uses v2 SDK: client.session.get({ sessionID })
 */

import path from "node:path"
import { type OpencodeClient } from "@opencode-ai/sdk/v2"

export type SessionTargetContext = {
  sessionID: string
  instanceWorkspaceDirectory: string
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function readSessionInstanceWorkspaceDirectory(value: unknown): string {
  const src = record(value)
  return text(src.instanceWorkspaceDirectory) || text(src.directory)
}

/**
 * Resolve target session context from a session ID.
 *
 * @param client - v2 opencode SDK client
 * @param sessionID - Target session ID
 * @returns SessionTargetContext or null if not found
 */
export async function resolveTargetSessionContext(
  client: OpencodeClient,
  sessionID: string,
): Promise<SessionTargetContext | null> {
  const cleanSessionID = text(sessionID)
  if (!cleanSessionID) return null

  try {
    const result = await client.session.get({ sessionID: cleanSessionID })
    const data = result && typeof result === "object" && "data" in result
      ? (result as { data?: unknown }).data
      : result
    const instanceWorkspaceDirectory = readSessionInstanceWorkspaceDirectory(data)
    if (!instanceWorkspaceDirectory) return null

    return {
      sessionID: cleanSessionID,
      instanceWorkspaceDirectory,
    }
  } catch {
    return null
  }
}

/**
 * Resolve target instance workspace context from a directory path.
 *
 * @param input - Object containing instanceWorkspaceDirectory
 * @returns InstanceWorkspaceInfo or null
 */
export function resolveTargetInstanceWorkspaceContext(
  input: { instanceWorkspaceDirectory?: string },
): { instanceWorkspaceDirectory: string; title: string } | null {
  const requestedDirectory = text(input.instanceWorkspaceDirectory)
  if (!requestedDirectory) return null
  return {
    instanceWorkspaceDirectory: path.resolve(requestedDirectory),
    title: path.basename(requestedDirectory) || requestedDirectory,
  }
}
