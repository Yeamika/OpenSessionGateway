/**
 * Server event router for canonical GlassVein control messages.
 *
 * Breaking wire contract: only `type="control"` plus `subtype` is accepted for
 * control dispatch. Legacy direct command wrappers, permission, and
 * question control routes are intentionally not supported here.
 */

import { type OpencodeClient } from "@opencode-ai/sdk/v2"
import { handleAddPrompt } from "./ws-event/AddPrompt.js"
import { handleAbortSession } from "./ws-event/AbortSession.js"
import { handleCompactSession } from "./ws-event/CompactSession.js"
import { handleCreateNewSession } from "./ws-event/CreateNewSession.js"
import { handleRenameSession } from "./ws-event/RenameSession.js"
import {
  handleRespondRequestion,
  buildRequestionResolvedPayload,
} from "./ws-event/Requestion.js"
import { handleRequestRuntime } from "./ws-event/RequestRuntime.js"

type QueryFactory = () => Record<string, unknown>

export type ServerEventDeps = {
  ctx: any
  query: QueryFactory
  v2client: OpencodeClient
  runtimeID: string
  GetCurrentClientInfo: () => Promise<Record<string, unknown>>
  WaitForSessionExecutionStart: (sessionID: string) => Promise<{ ok: boolean; error?: string }>
  resolveInstanceWorkspaceInfo: () => { instanceWorkspaceDirectory: string; title: string } | null
  sendRequestionResolved: (payload: Record<string, unknown>) => boolean
  connectionState: {
    status: "connecting" | "connected" | "disconnected"
    lastError: string
    routerUrl: string
  }
}

type RouteHandler = (payload: Record<string, unknown>, deps: ServerEventDeps) => Promise<unknown>

function normalizeSubtype(raw: unknown): string {
  const text = typeof raw === "string" ? raw.trim().toLowerCase() : ""
  return text.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}

function normalizePayload(payload: Record<string, unknown>, subtype: string): Record<string, unknown> {
  const next: Record<string, unknown> = { ...payload, subtype }
  if (typeof next.command !== "string") next.command = subtype
  if (next.command !== subtype) next.command = subtype
  if (typeof next.sessionID !== "string" && typeof next.sessionId === "string") next.sessionID = next.sessionId
  if (typeof next.msg !== "string" && typeof next.text === "string") next.msg = next.text
  if (typeof next.content !== "string" && typeof next.text === "string") next.content = next.text
  return next
}

export async function handleServerEvent(message: unknown, deps: ServerEventDeps): Promise<unknown> {
  const envelope = typeof message === "object" && message !== null
    ? message as Record<string, unknown>
    : {}

  if (envelope.type !== "control") {
    return { ok: false, accepted: false, error: "unsupported message type; expected type=control" }
  }

  const subtype = normalizeSubtype(envelope.subtype)
  if (!subtype) return { ok: false, accepted: false, error: "control subtype is required" }

  const payload = envelope.data && typeof envelope.data === "object"
    ? (envelope.data as Record<string, unknown>)
    : {}
  const routePayload = normalizePayload(payload, subtype)

  const routeHandlers: Record<string, RouteHandler> = {
    add_prompt: async (routePayload) => handleAddPrompt(deps.v2client, deps.query, deps.GetCurrentClientInfo, routePayload),
    abort_session: async (routePayload) => handleAbortSession(deps.v2client, deps.query, routePayload),
    compact_session: async (routePayload) => handleCompactSession(deps.v2client, routePayload),
    create_session: async (routePayload) => handleCreateNewSession(deps.v2client, routePayload, deps.WaitForSessionExecutionStart),
    rename_session: async (routePayload) => handleRenameSession(deps.v2client, deps.query, routePayload),
    resume_session: async () => ({
      ok: false,
      unsupported: true,
      subtype: "resume_session",
      error: "resume_session is not implemented by the current opencode adapter",
    }),
    requestion_respond: async (routePayload) => {
      const result = await handleRespondRequestion(deps.v2client, routePayload)
      const src = result && typeof result === "object" ? (result as Record<string, unknown>) : {}
      const sessionID = typeof routePayload.sessionID === "string" ? routePayload.sessionID : ""
      const requestID = typeof routePayload.requestID === "string" ? routePayload.requestID : ""
      if (sessionID && requestID) {
        deps.sendRequestionResolved(buildRequestionResolvedPayload({
          sessionID,
          requestID,
          status: typeof src.status === "string" ? src.status : (src.ok ? "answered" : "failed"),
          reason: typeof src.reason === "string" ? src.reason : null,
          message: typeof src.error === "string" ? src.error : null,
        }))
      }
      return result
    },
    request_runtime: async (routePayload) => handleRequestRuntime({
      ctx: deps.ctx,
      query: deps.query,
      v2client: deps.v2client,
      runtimeID: deps.runtimeID,
      currentClientInfo: deps.GetCurrentClientInfo,
      resolveInstanceWorkspaceInfo: deps.resolveInstanceWorkspaceInfo,
      payload: routePayload,
      connectionState: deps.connectionState,
    }),
  }

  const handler = routeHandlers[subtype]
  if (!handler) return { ok: false, accepted: false, subtype, error: "unsupported control subtype" }
  return handler(routePayload, deps)
}
