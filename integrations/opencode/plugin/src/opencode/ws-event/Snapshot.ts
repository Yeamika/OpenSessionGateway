/**
 * Snapshot handlers for querying current plugin state.
 *
 * These handlers respond to read requests from the router/control-surface.
 * The authoritative current state lives in the plugin, not the router.
 *
 * Supported snapshot paths:
 * - session.update.snapshot: Returns current session_update state
 * - requestion.snapshot: Returns current pending requestions
 * - session.view.snapshot: Returns combined session view
 */

import { resolveTargetSessionContext } from "../runtime/target-context.js"
import { getRequestionRegistryEntries } from "./Requestion.js"

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

/**
 * Session state registry — tracks current session_update state per sessionID.
 * This is populated by VeinManager when session.status events are received.
 */
const sessionStateRegistry = new Map<string, {
  state: string | null
  reason: string | null
  meta: Record<string, unknown> | null
  updatedAt: string
}>()

/**
 * Update session state in the registry.
 * Called by VeinManager when session.status events are received.
 */
export function updateSessionState(
  sessionID: string,
  state: string | null,
  reason: string | null,
  meta: Record<string, unknown> | null,
): void {
  if (sessionID) {
    sessionStateRegistry.set(sessionID, {
      state,
      reason,
      meta,
      updatedAt: new Date().toISOString(),
    })
  }
}

/**
 * Get session state from the registry.
 */
function getSessionState(sessionID: string) {
  return sessionStateRegistry.get(sessionID) || null
}

/**
 * Handle snapshot read requests.
 *
 * @param path - The snapshot path (e.g., "session.update.snapshot", "requestion.snapshot", "session.view.snapshot")
 * @param params - Optional parameters (e.g., { sessionID })
 * @returns The snapshot data
 */
export async function handleSnapshotReadRequest(
  ctx: any,
  path: string,
  params?: Record<string, unknown>,
): Promise<unknown> {
  const sessionID = text(params?.sessionID)

  switch (path) {
    case "session.update.snapshot":
      return handleSessionUpdateSnapshot(sessionID)

    case "requestion.snapshot":
      return handleRequestionSnapshot(sessionID)

    case "session.view.snapshot":
      return handleSessionViewSnapshot(ctx, sessionID)

    default:
      return { error: `unknown snapshot path: ${path}` }
  }
}

/**
 * Handle session.update.snapshot — returns current session_update state.
 */
function handleSessionUpdateSnapshot(sessionID: string) {
  if (!sessionID) {
    return { error: "sessionID is required" }
  }

  const state = getSessionState(sessionID)
  if (!state) {
    return {
      sessionID,
      state: null,
      reason: null,
      meta: null,
      updatedAt: null,
      found: false,
    }
  }

  return {
    sessionID,
    state: state.state,
    reason: state.reason,
    meta: state.meta,
    updatedAt: state.updatedAt,
    found: true,
  }
}

/**
 * Handle requestion.snapshot — returns current pending requestions for a session.
 */
function handleRequestionSnapshot(sessionID: string) {
  if (!sessionID) {
    return { error: "sessionID is required" }
  }

  const entries = getRequestionRegistryEntries(sessionID)
  return {
    sessionID,
    pendingRequestions: entries.map(([requestID, backend]) => ({
      requestID,
      backend,
    })),
    count: entries.length,
  }
}

/**
 * Handle session.view.snapshot — returns combined session view.
 */
async function handleSessionViewSnapshot(ctx: any, sessionID: string) {
  if (!sessionID) {
    return { error: "sessionID is required" }
  }

  // Get session context
  const target = await resolveTargetSessionContext(ctx, sessionID)

  // Get session update state
  const sessionState = getSessionState(sessionID)

  // Get pending requestions
  const requestionEntries = getRequestionRegistryEntries(sessionID)

  return {
    sessionID,
    session: {
      exists: !!target,
      instanceWorkspaceDirectory: target?.instanceWorkspaceDirectory || null,
    },
    sessionUpdate: sessionState ? {
      state: sessionState.state,
      reason: sessionState.reason,
      meta: sessionState.meta,
      updatedAt: sessionState.updatedAt,
    } : null,
    pendingRequestions: requestionEntries.map(([requestID, backend]) => ({
      requestID,
      backend,
    })),
    pendingRequestionCount: requestionEntries.length,
  }
}
