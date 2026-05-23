/**
 * Session state tracking — standalone module for GvOpencodeInstanceClient.
 *
 * Extracted from the old event-mapper path. Provides:
 * - Per-session state tracking (state/reason/extraInfo)
 * - session_update payload construction
 * - Message part extraInfo extraction (tool, reasoning)
 *
 * Used directly by GvOpencodeInstanceClient.onEvent — no intermediate mapper.
 */

// ── Types ─────────────────────────────────────────────────────────────

export type SessionState = "idle" | "busy" | "waiting" | "stopped"

export type SessionReason =
  | "pending"
  | "completed"
  | "tool"
  | "generating"
  | "reasoning"
  | "compacting"
  | "requestion"
  | "aborted"
  | "error"
  | null

export type SessionStateRow = {
  state: SessionState
  reason: SessionReason
  extraInfo: string | null
  touched: boolean
}

export type SessionUpdateMetadata = {
  reason?: SessionReason
  extraInfo?: string | null
}

export type SessionUpdatePayload = {
  sessionID: string
  state: SessionState
  metadata?: SessionUpdateMetadata
}

// ── Helpers ───────────────────────────────────────────────────────────

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function truncateText(value: string, maxLen: number): string | null {
  const clean = value.replace(/\r\n?/g, " ").replace(/\s+/g, " ").trim()
  if (!clean) return null
  const chars = Array.from(clean)
  if (chars.length <= maxLen) return clean
  return `${chars.slice(0, maxLen).join("")}...`
}

function extractHeading(value: string): string | null {
  const clean = value.replace(/\r\n?/g, "\n")
  const html = clean.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i)
  if (html?.[1]) {
    const next = html[1].replace(/<[^>]+>/g, " ").trim()
    if (next) return next
  }
  const atx = clean.match(/^\s{0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/m)
  if (atx?.[1]) return atx[1].trim()
  return null
}

export function extractToolExtraInfo(part: Record<string, unknown>): string | null {
  const tool = text(part.tool)
  if (!tool) return null
  const state = record(part.state)
  const input = record(state.input)
  switch (tool) {
    case "read":
    case "edit":
    case "write":
      return text(input.filePath) || tool
    case "bash":
      return text(input.command) || text(input.description) || tool
    case "glob":
    case "grep":
      return text(input.pattern) || tool
    case "task":
      return text(input.description) || tool
    default:
      return tool
  }
}

export function extractReasoningExtraInfo(textContent: string): string | null {
  if (!textContent) return null
  const heading = extractHeading(textContent)
  if (heading) return heading
  return truncateText(textContent, 40)
}

// ── Session state store ───────────────────────────────────────────────

export type SessionStateStore = ReturnType<typeof createSessionStateStore>

export function createSessionStateStore() {
  const sessionStates: Map<string, SessionStateRow> = new Map()

  function ensure(sessionID: string): SessionStateRow | null {
    const clean = text(sessionID)
    if (!clean) return null
    const hit = sessionStates.get(clean)
    if (hit) return hit
    const created: SessionStateRow = {
      state: "idle",
      reason: "pending",
      extraInfo: null,
      touched: false,
    }
    sessionStates.set(clean, created)
    return created
  }

  function set(
    sessionID: string,
    state: SessionState,
    reason: SessionReason,
    extraInfo: string | null = null,
    touched = false,
  ) {
    const hit = ensure(sessionID)
    if (!hit) return
    hit.state = state
    hit.reason = reason
    hit.extraInfo = extraInfo
    hit.touched = touched || hit.touched
  }

  function clear(sessionID: string) {
    const clean = text(sessionID)
    if (!clean) return
    sessionStates.delete(clean)
  }

  function get(sessionID: string): SessionStateRow | null {
    const clean = text(sessionID)
    if (!clean) return null
    return sessionStates.get(clean) || null
  }

  function buildUpdatePayload(sessionID: string): SessionUpdatePayload {
    const hit = sessionStates.get(sessionID)
    if (!hit) return { sessionID, state: "idle" }
    const metadata: SessionUpdateMetadata = {}
    if (hit.reason) metadata.reason = hit.reason
    if (hit.extraInfo) metadata.extraInfo = hit.extraInfo
    return {
      sessionID,
      state: hit.state,
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    }
  }

  return { ensure, set, clear, get, buildUpdatePayload, map: sessionStates }
}

// ── Event handlers (each returns session_update payload or null) ──────

export function handleSessionStatus(
  props: Record<string, unknown>,
  eventSessionID: string,
  store: SessionStateStore,
): SessionUpdatePayload | null {
  const status = record(props.status)
  const statusType = text(status.type)
  if (statusType === "busy") {
    store.set(eventSessionID, "busy", null, null)
  } else if (statusType === "retry") {
    store.set(eventSessionID, "busy", "generating", null, true)
  } else if (statusType === "idle") {
    const hit = store.ensure(eventSessionID)
    store.set(eventSessionID, "idle", hit?.touched ? "completed" : "pending", null, hit?.touched === true)
  } else {
    return null
  }
  return store.buildUpdatePayload(eventSessionID)
}

export function handleSessionIdle(
  eventSessionID: string,
  store: SessionStateStore,
): SessionUpdatePayload {
  const hit = store.ensure(eventSessionID)
  store.map.delete(text(eventSessionID))
  store.set(eventSessionID, "idle", hit?.touched ? "completed" : "pending", null, hit?.touched === true)
  return store.buildUpdatePayload(eventSessionID)
}

export function handleSessionCreated(
  eventSessionID: string,
  store: SessionStateStore,
): void {
  store.ensure(eventSessionID)
}

export function handleSessionDeleted(
  eventSessionID: string,
  store: SessionStateStore,
): SessionUpdatePayload {
  store.clear(eventSessionID)
  return { sessionID: eventSessionID, state: "idle" }
}

export function handleSessionError(
  props: Record<string, unknown>,
  eventSessionID: string,
  store: SessionStateStore,
): SessionUpdatePayload {
  const err = record(props.error)
  const data = record(err.data)
  const name = text(err.name)
  const message = text(data.message) || text(err.message) || name || "session error"
  const reason = name === "MessageAbortedError" || /abort/i.test(message) ? "aborted" : "error"
  store.set(eventSessionID, "stopped", reason, truncateText(message, 60), true)
  return store.buildUpdatePayload(eventSessionID)
}

export function handleSessionCompacted(
  eventSessionID: string,
  store: SessionStateStore,
): SessionUpdatePayload {
  store.set(eventSessionID, "busy", "compacting", null, true)
  return store.buildUpdatePayload(eventSessionID)
}

export function handleMessagePartUpdated(
  props: Record<string, unknown>,
  eventSessionID: string,
  store: SessionStateStore,
): SessionUpdatePayload | null {
  const part = record(props.part)
  const partType = text(part.type)
  if (partType === "tool") {
    const extraInfo = extractToolExtraInfo(part)
    if (extraInfo) {
      store.set(eventSessionID, "busy", "tool", extraInfo, true)
    }
  } else if (partType === "reasoning") {
    const reasoningText = text(part.text)
    const extraInfo = extractReasoningExtraInfo(reasoningText)
    if (extraInfo) {
      store.set(eventSessionID, "busy", "reasoning", extraInfo, true)
    }
  } else if (partType === "text") {
    store.set(eventSessionID, "busy", "generating", null, true)
  } else if (partType === "compaction") {
    store.set(eventSessionID, "busy", "compacting", null, true)
  } else {
    return null
  }
  return store.buildUpdatePayload(eventSessionID)
}

export function handleTuiSessionSelect(
  props: Record<string, unknown>,
  store: SessionStateStore,
): void {
  const sessionID = text(props.sessionID)
  if (sessionID) store.ensure(sessionID)
}
