/**
 * Requestion control command handler.
 *
 * Unified handler for responding to permission/question requests.
 * Uses v2 SDK: client.permission.reply() / client.question.reply()
 *
 * Requestion response control payload:
 * { sessionID: string, requestID: string, answers: string[][] }
 */

import { type OpencodeClient } from "@opencode-ai/sdk/v2"
import { resolveTargetSessionContext } from "../runtime/target-context.js"

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

function ok(value: unknown): boolean {
  if (value === true) return true
  const src = record(value)
  return src.data === true
}

/**
 * Short-lived registry: sessionID:requestID -> backend type
 * This is internal only and never exposed in payloads.
 */
const requestionRegistry = new Map<string, "permission" | "question">()

/**
 * Register a requestion backend type.
 * Called when a permission.asked or question.asked event is received.
 */
export function registerRequestionBackend(
  sessionID: string,
  requestID: string,
  backend: "permission" | "question",
): void {
  if (sessionID && requestID) {
    requestionRegistry.set(`${sessionID}:${requestID}`, backend)
  }
}

/**
 * Get the backend type for a requestion.
 * Returns null if not found.
 */
function getRequestionBackend(sessionID: string, requestID: string): "permission" | "question" | null {
  return requestionRegistry.get(`${sessionID}:${requestID}`) || null
}

/**
 * Remove a requestion from the registry after it's resolved.
 */
function removeRequestionFromRegistry(sessionID: string, requestID: string): void {
  requestionRegistry.delete(`${sessionID}:${requestID}`)
}

/**
 * Get all requestion entries for a specific session.
 * Returns array of [requestID, backend] tuples.
 * Used by Snapshot handlers for requestion.snapshot queries.
 */
export function getRequestionRegistryEntries(sessionID: string): Array<[string, "permission" | "question"]> {
  const entries: Array<[string, "permission" | "question"]> = []
  const prefix = `${sessionID}:`
  for (const [key, backend] of requestionRegistry.entries()) {
    if (key.startsWith(prefix)) {
      const requestID = key.slice(prefix.length)
      entries.push([requestID, backend])
    }
  }
  return entries
}

/**
 * Map answers[0][0] to permission reply action.
 * Returns "once" for approve, "reject" for deny/cancel, or null if invalid.
 */
function mapAnswersToPermissionReply(answers: string[][]): "once" | "always" | "reject" | null {
  if (!Array.isArray(answers) || answers.length === 0) return null
  const firstAnswer = answers[0]
  if (!Array.isArray(firstAnswer) || firstAnswer.length === 0) return null
  const action = text(firstAnswer[0]).toLowerCase()
  if (action === "approve") return "once"
  if (action === "deny" || action === "cancel") return "reject"
  return null
}

/**
 * Handle requestion respond control command.
 *
 * Payload: { sessionID, requestID, answers }
 * - sessionID: target session
 * - requestID: target request (permission or question)
 * - answers: string[][] - for permission: [["approve"]] / [["deny"]] / [["cancel"]]
 *            for question: array of answer arrays
 *
 * Returns: { ok, sessionID, requestID, status, error? }
 */
export async function handleRespondRequestion(
  client: OpencodeClient,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const sessionID = text(payload.sessionID)
  const requestID = text(payload.requestID)
  const answers = Array.isArray(payload.answers) ? payload.answers as string[][] : []

  if (!sessionID) {
    return { ok: false, sessionID: "", requestID, status: "failed", error: "sessionID is required" }
  }

  if (!requestID) {
    return { ok: false, sessionID, requestID: "", status: "failed", error: "requestID is required" }
  }

  if (!Array.isArray(answers) || answers.length === 0) {
    return { ok: false, sessionID, requestID, status: "failed", error: "answers is required and must be non-empty" }
  }

  const target = await resolveTargetSessionContext(client, sessionID)
  if (!target?.instanceWorkspaceDirectory) {
    return { ok: false, sessionID, requestID, status: "failed", error: "target session context not found" }
  }

  // Determine backend type from registry
  const backend = getRequestionBackend(sessionID, requestID)

  // Default to question if unknown (more generic)
  const resolvedBackend = backend || "question"

  try {
    if (resolvedBackend === "permission") {
      return await handlePermissionBackend(client, sessionID, requestID, answers, target.instanceWorkspaceDirectory)
    } else {
      return await handleQuestionBackend(client, sessionID, requestID, answers, target.instanceWorkspaceDirectory)
    }
  } catch (error) {
    return {
      ok: false,
      sessionID,
      requestID,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    // Clean up registry after response
    removeRequestionFromRegistry(sessionID, requestID)
  }
}

/**
 * Handle permission backend response.
 */
async function handlePermissionBackend(
  client: OpencodeClient,
  sessionID: string,
  requestID: string,
  answers: string[][],
  directory: string,
): Promise<Record<string, unknown>> {
  const reply = mapAnswersToPermissionReply(answers)
  if (!reply) {
    return {
      ok: false,
      sessionID,
      requestID,
      status: "failed",
      error: "invalid permission answer: answers[0][0] must be 'approve', 'deny', or 'cancel'",
    }
  }

  const response = await client.permission.reply({
    requestID,
    directory,
    reply,
  })

  if (!ok(response)) {
    return { ok: false, sessionID, requestID, status: "failed", error: "permission reply failed" }
  }

  return {
    ok: true,
    sessionID,
    requestID,
    status: reply === "once" ? "approved" : "denied",
  }
}

/**
 * Handle question backend response.
 */
async function handleQuestionBackend(
  client: OpencodeClient,
  sessionID: string,
  requestID: string,
  answers: string[][],
  directory: string,
): Promise<Record<string, unknown>> {
  const response = await client.question.reply({
    requestID,
    directory,
    answers,
  })

  if (!ok(response)) {
    return { ok: false, sessionID, requestID, status: "failed", error: "question reply failed" }
  }

  return {
    ok: true,
    sessionID,
    requestID,
    status: "answered",
  }
}

/**
 * Build requestion resolved payload for GV protocol.
 * Unified output: { sessionID, requestID, status, updatedAt, message?, reason? }
 */
export function buildRequestionResolvedPayload(input: {
  sessionID: string
  requestID: string
  status: string
  reason?: string | null
  message?: string | null
}) {
  return {
    sessionID: input.sessionID,
    requestID: input.requestID,
    status: input.status,
    updatedAt: new Date().toISOString(),
    reason: input.reason || null,
    message: input.message || null,
  }
}

/**
 * Build requestion updated payload for GV protocol.
 * Unified output: { sessionID, requestID, status, updatedAt, message?, reason? }
 */
export function buildRequestionUpdatedPayload(input: {
  sessionID: string
  requestID: string
  status: string
  reason?: string | null
  message?: string | null
}) {
  return {
    sessionID: input.sessionID,
    requestID: input.requestID,
    status: input.status,
    updatedAt: new Date().toISOString(),
    reason: input.reason || null,
    message: input.message || null,
  }
}
