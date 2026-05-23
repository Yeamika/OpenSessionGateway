/**
 * Question control command handler.
 *
 * Uses v2 SDK: client.question.reply() / client.question.reject()
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
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString()
  return new Date().toISOString()
}

function source(event: Record<string, unknown>): Record<string, unknown> {
  const props = record(event.properties)
  const candidates = [record(props.question), record(props.request), record(props.info), props]
  return candidates.find((item) => Object.keys(item).length > 0) || {}
}

function questions(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const row = record(item)
    const question = text(row.question)
    if (!question) return []
    const options = Array.isArray(row.options)
      ? row.options.flatMap((entry) => {
        const option = record(entry)
        const label = text(option.label)
        if (!label) return []
        return [{ label, description: text(option.description) || undefined }]
      })
      : []
    return [{
      header: text(row.header),
      question,
      options,
      multiple: row.multiple === true ? true : undefined,
      custom: row.custom === true ? true : undefined,
    }]
  })
}

function ok(value: unknown): boolean {
  if (value === true) return true
  const src = record(value)
  return src.data === true
}

/**
 * Build question asked payload for GV protocol.
 * Output: { sessionID, requestID, title, questions, requestedAt }
 * No displayID, detail, event, or properties exposed.
 *
 * Also registers the requestion backend for this requestID.
 */
export function buildQuestionAskedPayload(input: {
  event: Record<string, unknown>
  query: QueryFactory
}) {
  const src = source(input.event)
  const sessionID = text(src.sessionID)
  const requestID = text(src.questionID || src.id || src.requestID)
  const list = questions(src.questions)
  if (!requestID || !sessionID || list.length === 0) return null

  // Register requestion backend for this request
  registerRequestionBackend(sessionID, requestID, "question")

  return {
    sessionID,
    requestID,
    title: text(src.title) || list[0]?.header || list[0]?.question || "Question",
    questions: list,
    requestedAt: readTime(src.requestedAt || src.createdAt || input.event.time),
  }
}

/**
 * Build question updated payload for GV protocol.
 * Output: { sessionID, requestID, status, updatedAt }
 */
export function buildQuestionUpdatedPayload(input: {
  event: Record<string, unknown>
  status: "answered" | "rejected" | "failed"
}) {
  const src = source(input.event)
  const sessionID = text(src.sessionID)
  const requestID = text(src.questionID || src.id || src.requestID)
  if (!requestID) return null
  return {
    sessionID: sessionID || null,
    requestID,
    status: input.status,
    updatedAt: readTime(src.updatedAt || input.event.time),
  }
}

/**
 * Handle reply question request using sessionID + requestID.
 * Uses v2 SDK: client.question.reply() / client.question.reject()
 */
export async function handleReplyQuestionRequest(
  client: OpencodeClient,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const sessionID = text(payload.sessionID)
  const requestID = text(payload.requestID)
  const replyType = text(payload.replyType).toLowerCase()

  if (!sessionID) {
    return { ok: false, sessionID: "", requestID, replyType, error: "sessionID is required" }
  }

  if (!requestID) {
    return { ok: false, sessionID, requestID: "", replyType, error: "requestID is required" }
  }

  if (!replyType || (replyType !== "answer" && replyType !== "reject")) {
    return { ok: false, sessionID, requestID, replyType, error: "replyType must be answer or reject" }
  }

  const target = await resolveTargetSessionContext(client, sessionID)
  const directory = target?.instanceWorkspaceDirectory || undefined

  try {
    if (replyType === "reject") {
      const response = await client.question.reject({
        requestID,
        directory,
      })
      if (!ok(response)) {
        return { ok: false, sessionID, requestID, replyType, error: "question reject failed" }
      }
      return { ok: true, sessionID, requestID, replyType }
    }

    const response = await client.question.reply({
      requestID,
      directory,
      answers: Array.isArray(payload.answers) ? payload.answers as string[][] : [],
    })
    if (!ok(response)) {
      return { ok: false, sessionID, requestID, replyType, error: "question reply failed" }
    }
    return { ok: true, sessionID, requestID, replyType }
  } catch (error) {
    return {
      ok: false,
      sessionID,
      requestID,
      replyType,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Build question resolved payload for GV protocol.
 * Output: { sessionID, requestID, status, updatedAt, reason, message }
 */
export function buildQuestionResolvedPayload(input: {
  sessionID: string
  requestID: string
  replyType: string
  answers?: string[][] | null
  reason?: string | null
  ok: boolean
  error?: string | null
}) {
  return {
    sessionID: input.sessionID,
    requestID: input.requestID,
    status: input.ok ? (input.replyType === "reject" ? "rejected" : "answered") : "failed",
    updatedAt: new Date().toISOString(),
    reason: input.reason || null,
    message: input.error || null,
  }
}
