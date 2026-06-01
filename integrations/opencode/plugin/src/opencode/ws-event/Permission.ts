/**
 * Permission control command handler.
 *
 * Uses v2 SDK: client.permission.reply({ requestID, directory, reply, message })
 */

import { type OpencodeClient } from "@opencode-ai/sdk/v2"
import { resolveTargetSessionContext } from "../runtime/target-context.js"
import { registerRequestionBackend } from "./Requestion.js"

type QueryFactory = () => Record<string, unknown>

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

function readTime(value: unknown): string {
  const direct = text(value)
  if (direct) return direct
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString()
  }
  return new Date().toISOString()
}

function firstString(src: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = text(src[key])
    if (value) return value
  }
  return ""
}

function nestedSource(event: Record<string, unknown>): Record<string, unknown> {
  const props = record(event.properties)
  const candidates = [
    record(props.permission),
    record(props.ask),
    record(props.request),
    record(props.info),
    props,
  ]
  return candidates.find((item) => Object.keys(item).length > 0) || {}
}

function replyFromDecision(action: string): "once" | "always" | "reject" {
  if (action === "approve") return "once"
  if (action === "deny") return "reject"
  return "reject"
}

function ok(value: unknown): boolean {
  if (value === true) return true
  const src = record(value)
  return src.data === true
}

/**
 * Build permission asked payload for GV protocol.
 * Output: { sessionID, requestID, title, description, questions, requestedAt }
 */
export function buildPermissionAskedPayload(input: {
  event: Record<string, unknown>
  currentClientInfo: Record<string, unknown>
  instanceWorkspace: { instanceWorkspaceDirectory: string; title: string } | null
  query: QueryFactory
}) {
  const event = input.event
  const props = record(event.properties)
  const source = nestedSource(event)

  const sessionID = text(props.sessionID) || text(source.sessionID)
  const requestID = text(source.requestID) || text(source.permissionID) || text(source.id)
  const title = firstString(source, ["title", "description", "summary", "command"])
  const reason = text(source.reason) || text(source.description) || text(source.summary)
  const tool = text(source.tool) || text(source.command)
  const action = firstString(source, ["action", "type"])
  const actionDescription = text(source.actionDescription) || text(source.description)
  const createdAt = readTime(source.createdAt) || readTime(source.timeCreated) || readTime(source.timestamp) || new Date().toISOString()

  if (!sessionID || !requestID || !title) return null

  registerPermissionBackend(sessionID, requestID)

  const description = reason || actionDescription || tool || null

  return {
    sessionID,
    requestID,
    title,
    description,
    questions: [{
      question: title,
      options: [
        { label: "approve", description: "Allow this operation" },
        { label: "deny", description: "Deny this operation" },
      ],
      multiple: false,
      custom: false,
    }],
    requestedAt: createdAt,
  }
}

/**
 * Register permission backend for requestion routing.
 */
export function registerPermissionBackend(sessionID: string, requestID: string): void {
  registerRequestionBackend(sessionID, requestID, "permission")
}

/**
 * Handle permission resolve control command.
 *
 * Payload: { sessionID, requestID, action, reason? }
 * - action: "approve" | "deny" | "cancel"
 * - reason: optional reason for denial/cancellation
 */
export async function handleResolvePermission(
  client: OpencodeClient,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const sessionID = text(payload.sessionID)
  const requestID = text(payload.requestID)
  const action = text(payload.action)
  const reason = text(payload.reason) || null

  if (!sessionID) return { ok: false, sessionID: "", requestID, action, error: "sessionID is required" }
  if (!requestID) return { ok: false, sessionID, requestID: "", action, error: "requestID is required" }
  if (!action || (action !== "approve" && action !== "deny" && action !== "cancel")) {
    return { ok: false, sessionID, requestID, action, error: "action must be approve, deny, or cancel" }
  }

  const target = await resolveTargetSessionContext(client, sessionID)
  if (!target?.instanceWorkspaceDirectory) {
    return { ok: false, sessionID, requestID, action, error: "target session context not found" }
  }

  try {
    const response = await client.permission.reply({
      requestID,
      directory: target.instanceWorkspaceDirectory,
      reply: replyFromDecision(action),
      message: reason || undefined,
    })
    if (!ok(response)) {
      return {
        ok: false,
        sessionID,
        requestID,
        action,
        error: "permission reply failed",
      }
    }
    return {
      ok: true,
      sessionID,
      requestID,
      action,
    }
  } catch (error) {
    return {
      ok: false,
      sessionID,
      requestID,
      action,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Build permission resolved payload for GV protocol.
 * Output: { sessionID, requestID, status, updatedAt, reason, message }
 */
export function buildPermissionResolvedPayload(input: {
  sessionID: string
  requestID: string
  action: string
  reason?: string | null
  ok: boolean
  error?: string | null
}) {
  return {
    sessionID: input.sessionID,
    requestID: input.requestID,
    status: input.ok
      ? input.action === "approve"
        ? "approved"
        : input.action === "deny"
          ? "denied"
          : "cancelled"
      : "failed",
    updatedAt: new Date().toISOString(),
    reason: input.reason || null,
    message: input.error || null,
  }
}
