/**
 * GetSessionMsg — get session messages handler.
 *
 * Uses v2 SDK: client.session.messages({ sessionID, directory, limit })
 */

import { type OpencodeClient } from "@opencode-ai/sdk/v2"
import { resolveTargetSessionContext } from "../runtime/target-context.js"

type QueryFactory = () => Record<string, unknown>

export type GetSessionMsgItem = {
  id: string
  role: string
  content: string
  time: string
}

export type GetSessionMsgResponse = {
  runtimeID: string
  sessionID: string
  realsize: number
  list: GetSessionMsgItem[]
  error?: string
}

type GetSessionMsgRequest = {
  sessionID: string
  size: number
  anchorTime?: string
}

type MessageRow = GetSessionMsgItem & {
  timeMs: number
}

function readRegexArg(src: Record<string, unknown>): RegExp | null {
  const text = typeof src.regex === "string" ? src.regex.trim() : ""
  if (!text) return null
  try {
    return new RegExp(text)
  } catch {
    return null
  }
}

function readAnchorTime(value: unknown): number | null {
  const text = typeof value === "string" ? value.trim() : ""
  if (!text) return null
  const ms = Date.parse(text)
  return Number.isFinite(ms) ? ms : null
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function timeInfo(info: Record<string, unknown>): { label: string; ms: number } {
  const created = info.timeCreated
  const updated = info.timeUpdated
  const label = typeof created === "number"
    ? new Date(created).toISOString()
    : typeof updated === "number"
      ? new Date(updated).toISOString()
      : ""
  const ms = typeof created === "number" ? created : typeof updated === "number" ? updated : 0
  return { label, ms }
}

function messageContent(msg: Record<string, unknown>, info: Record<string, unknown>): string {
  const parts = Array.isArray(info.parts) ? info.parts : []
  const texts: string[] = []
  for (const p of parts) {
    if (!p || typeof p !== "object") continue
    const part = p as Record<string, unknown>
    if (part.type === "text" && typeof part.text === "string") {
      texts.push(part.text)
    }
  }
  if (texts.length > 0) return texts.join("\n")
  return text(msg.content) || text(info.summary) || ""
}

function compareRows(a: MessageRow, b: MessageRow): number {
  return a.timeMs - b.timeMs
}

function createGetSessionMsgRequest(raw: Record<string, unknown>): GetSessionMsgRequest {
  const sessionID = typeof raw.sessionID === "string" ? raw.sessionID.trim() : ""
  const size = typeof raw.size === "number" && raw.size > 0 ? raw.size : 10
  const anchorTime = typeof raw.anchorTime === "string" ? raw.anchorTime.trim() : undefined
  return { sessionID, size, anchorTime }
}

export async function handleGetSessionMsg(
  client: OpencodeClient,
  _query: QueryFactory,
  runtimeID: string,
  payload: Record<string, unknown>,
): Promise<GetSessionMsgResponse> {
  const { sessionID, size, anchorTime } = createGetSessionMsgRequest(payload)
  const regex = readRegexArg(payload)
  const anchorTimeMs = readAnchorTime(anchorTime)
  if (!sessionID) {
    return {
      runtimeID,
      sessionID: "",
      realsize: 0,
      list: [],
      error: "sessionID is required",
    }
  }

  const target = await resolveTargetSessionContext(client, sessionID)
  if (!target) {
    return {
      runtimeID,
      sessionID,
      realsize: 0,
      list: [],
      error: "target session context not found",
    }
  }

  const fetchLimit = anchorTimeMs === null
    ? Math.max(size * 5, size)
    : Math.max(size * 20, 200)

  let source: unknown[] = []
  try {
    const result = await client.session.messages({
      sessionID: target.sessionID,
      directory: target.instanceWorkspaceDirectory || undefined,
      limit: fetchLimit,
    })
    const raw = result && typeof result === "object" && "data" in result
      ? (result as { data?: unknown }).data
      : result
    source = Array.isArray(raw) ? raw : []
  } catch {
    source = []
  }

  const matched: MessageRow[] = []
  for (const raw of source) {
    if (!raw || typeof raw !== "object") continue
    const msg = raw as Record<string, unknown>
    const info = msg.info && typeof msg.info === "object" ? (msg.info as Record<string, unknown>) : {}
    const time = timeInfo(info)
    if (anchorTimeMs !== null && (!time.ms || time.ms <= anchorTimeMs)) continue
    const content = messageContent(msg, info)
    if (regex && !regex.test(content)) continue
    matched.push({
      id: text(info.id) || text(msg.id),
      role: text(info.role),
      content,
      time: time.label || text(msg.createdAt) || text(msg.updatedAt),
      timeMs: time.ms,
    })
  }

  matched.sort(compareRows)
  const list = (anchorTimeMs === null ? matched.slice(-size) : matched.slice(0, size)).map(({ timeMs: _timeMs, ...row }) => row)
  return {
    runtimeID,
    sessionID: target.sessionID,
    realsize: matched.length,
    list,
  }
}
