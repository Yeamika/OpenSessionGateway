/**
 * RequestRuntime control command handler (read-only minimal implementation).
 *
 * This module handles the "requestruntime" control command, which returns
 * current runtime state information without any side effects.
 * It's a minimal read-only implementation for GlassVein plugin.
 */

import { type OpencodeClient } from "@opencode-ai/sdk/v2"
import { resolveTargetSessionContext } from "../runtime/target-context.js"

type QueryFactory = () => Record<string, unknown>

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

export type RequestRuntimeInput = {
  ctx: any
  query: QueryFactory
  v2client: OpencodeClient
  runtimeID: string
  currentClientInfo: () => Promise<Record<string, unknown>>
  resolveInstanceWorkspaceInfo: () => { instanceWorkspaceDirectory: string; title: string } | null
  payload: Record<string, unknown>
  connectionState: {
    status: "connecting" | "connected" | "disconnected"
    lastError: string
    routerUrl: string
  }
}

export type RequestRuntimeResponse = {
  ok: boolean
  runtimeID: string
  connection: {
    status: "connecting" | "connected" | "disconnected"
    lastError: string
    routerUrl: string
  }
  workspace: {
    directory: string
    title: string
  } | null
  client: {
    sessionID: string | null
    sessionTitle: string | null
    status: string | null
    cwd: string | null
  }
  session?: {
    requested: boolean
    exists: boolean
    sessionID: string
    targetDirectory: string | null
  }
}

export async function handleRequestRuntime(input: RequestRuntimeInput): Promise<RequestRuntimeResponse> {
  const sessionID = text(input.payload.sessionID)
  const currentInfoRaw = await input.currentClientInfo().catch(() => ({}))
  const currentInfo = readRecord(currentInfoRaw)
  const instanceInfo = input.resolveInstanceWorkspaceInfo()

  // If no sessionID provided, return basic runtime info
  if (!sessionID) {
    return {
      ok: true,
      runtimeID: input.runtimeID,
      connection: {
        status: input.connectionState.status,
        lastError: input.connectionState.lastError,
        routerUrl: input.connectionState.routerUrl,
      },
      workspace: instanceInfo ? {
        directory: instanceInfo.instanceWorkspaceDirectory,
        title: instanceInfo.title,
      } : null,
      client: {
        sessionID: text(currentInfo.sessionID) || null,
        sessionTitle: text(currentInfo.sessionTitle) || null,
        status: text(currentInfo.status) || null,
        cwd: text(currentInfo.cwd) || null,
      },
    }
  }

  // If sessionID provided, resolve target context
  const sessionTarget = await resolveTargetSessionContext(input.v2client, sessionID)

  return {
    ok: true,
    runtimeID: input.runtimeID,
    connection: {
      status: input.connectionState.status,
      lastError: input.connectionState.lastError,
      routerUrl: input.connectionState.routerUrl,
    },
    workspace: instanceInfo ? {
      directory: instanceInfo.instanceWorkspaceDirectory,
      title: instanceInfo.title,
    } : null,
    client: {
      sessionID: text(currentInfo.sessionID) || null,
      sessionTitle: text(currentInfo.sessionTitle) || null,
      status: text(currentInfo.status) || null,
      cwd: text(currentInfo.cwd) || null,
    },
    session: {
      requested: true,
      exists: Boolean(sessionTarget),
      sessionID,
      targetDirectory: sessionTarget?.instanceWorkspaceDirectory || null,
    },
  }
}
