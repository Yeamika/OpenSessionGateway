/**
 * Local type definitions — replaces @opensessiongateway/protocol-library dependency.
 *
 * These types are self-contained and do NOT depend on any OSG package.
 */

// ── Session state types ─────────────────────────────────────────────

export type ClientSessionState = "idle" | "busy" | "waiting" | "stopped" | null

export type ClientSessionReason =
  | "completed"
  | "pending"
  | "tool"
  | "generating"
  | "reasoning"
  | "compacting"
  | "permission"
  | "question"
  | "aborted"
  | "error"
  | null

export type ClientSessionMeta = Record<string, unknown> | null

// ── CurrentClientInfo ───────────────────────────────────────────────

export type CurrentClientInfo = {
  sessionID: string
  sessionTitle: string
  status: string
  cwd: string
  sessionState: ClientSessionState
  sessionReason: ClientSessionReason
  sessionMeta: ClientSessionMeta
  currentContextTokens: number | null
  maxContextTokens: number | null
}

// ── Content executing payload ───────────────────────────────────────

export type ClientContentExecuteingPayload = {
  displayID?: string
  instanceWorkspaceDirectory?: string
  session?: {
    sessionID?: string
    title?: string
    state?: ClientSessionState
    reason?: ClientSessionReason
    meta?: ClientSessionMeta
    currentContextTokens?: number | null
    maxContextTokens?: number | null
  }
}

// ── Normalizers ─────────────────────────────────────────────────────

export function normalizeClientSessionState(value: unknown): ClientSessionState {
  if (value === "idle" || value === "busy" || value === "waiting" || value === "stopped") return value
  return null
}

export function normalizeClientSessionReason(value: unknown): ClientSessionReason {
  const valid = ["completed", "pending", "tool", "generating", "reasoning", "compacting", "permission", "question", "aborted", "error"]
  if (typeof value === "string" && valid.includes(value)) return value as ClientSessionReason
  return null
}

export function normalizeClientSessionMeta(value: unknown): ClientSessionMeta {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>
  return null
}

export function createClientContentExecuteingPayload(input: {
  displayID?: string
  instanceWorkspaceDirectory?: string
  session?: {
    sessionID?: string
    title?: string
    state?: ClientSessionState
    reason?: ClientSessionReason
    meta?: ClientSessionMeta
    currentContextTokens?: number | null
    maxContextTokens?: number | null
  }
}): ClientContentExecuteingPayload {
  return {
    ...(input.displayID ? { displayID: input.displayID } : {}),
    ...(input.instanceWorkspaceDirectory ? { instanceWorkspaceDirectory: input.instanceWorkspaceDirectory } : {}),
    ...(input.session ? { session: input.session } : {}),
  }
}
