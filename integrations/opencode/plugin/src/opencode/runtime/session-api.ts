/**
 * Session API helper functions for building opencode SDK parameters.
 *
 * These functions return plain objects whose keys are the v2 SDK top-level
 * parameters (sessionID, directory, limit, …) — no nested `path` / `query` /
 * `body` containers.
 */

/**
 * Build options for session operations that need a session ID
 * and optional directory (get, abort, etc.).
 */
export function sessionPathOptions(sessionID: string, directory?: string) {
  return {
    sessionID,
    ...(directory ? { directory } : {}),
  }
}

/**
 * Build options for session.messages().
 * Includes optional limit.
 */
export function sessionMessagesOptions(sessionID: string, directory?: string, limit?: number) {
  return {
    sessionID,
    ...(directory ? { directory } : {}),
    ...(limit != null ? { limit } : {}),
  }
}

/**
 * Build options for session.create().
 * No sessionID; optional directory plus arbitrary body fields flattened.
 */
export function sessionCreateOptions(directory?: string, body?: Record<string, unknown>) {
  return {
    ...(directory ? { directory } : {}),
    ...(body && Object.keys(body).length > 0 ? body : {}),
  }
}

/**
 * Build options for session.update().
 * sessionID plus optional directory and body fields flattened.
 */
export function sessionUpdateOptions(sessionID: string, directory?: string, body?: Record<string, unknown>) {
  return {
    sessionID,
    ...(directory ? { directory } : {}),
    ...(body && Object.keys(body).length > 0 ? body : {}),
  }
}

/**
 * Build options for session.summarize().
 * sessionID plus optional directory and body fields flattened.
 */
export function sessionSummarizeOptions(sessionID: string, directory?: string, body?: Record<string, unknown>) {
  return {
    sessionID,
    ...(directory ? { directory } : {}),
    ...(body && Object.keys(body).length > 0 ? body : {}),
  }
}

/**
 * Build options for session.promptAsync().
 * sessionID plus optional directory and body fields flattened.
 */
export function sessionPromptAsyncOptions(sessionID: string, directory?: string, body?: Record<string, unknown>) {
  return {
    sessionID,
    ...(directory ? { directory } : {}),
    ...(body && Object.keys(body).length > 0 ? body : {}),
  }
}

/**
 * Extract data from an SDK result, returning null on error or missing data.
 */
export function resultData<T>(result: { data?: T; error?: unknown } | null | undefined): T | null {
  if (!result || result.error) return null
  return result.data ?? null
}
