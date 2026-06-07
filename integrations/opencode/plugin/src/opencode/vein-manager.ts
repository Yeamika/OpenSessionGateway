/**
 * VeinManager — connection and event routing manager.
 *
 * Migrated from client-opencode-plugin-v2/lib/OSG-opencode/manager.ts
 * Replaced OSGClient with GlassveinWsClient.
 * Removed @opensessiongateway/protocol-library and client-library dependencies.
 *
 * session_update 主链路收敛：
 *   - 移除 permissionRoutes/questionRoutes 全局 route map
 *   - resolveInstanceForCommand 只按 sessionID/instanceWorkspaceDirectory/displayID 定位
 *   - permission/question resolve/reply 直接用 sessionID，不再需要 ID route map
 *
 * Excluded per user decision:
 *   - RequestInstanceWorkspaceReload
 *   - SessionList
 *   - ListAvailableModels
 *   - ShowToast
 */

import { GlassveinWsClient, type GlassveinClientConfig } from "../glassvein-router/glassvein-ws-client.js"
import type { UploadSubtype } from "@opensessiongateway/osgp"
import { type OpencodeClient } from "@opencode-ai/sdk/v2"
import { handleServerEvent } from "./server-event.js"
import { handleSnapshotReadRequest } from "./ws-event/Snapshot.js"
import { handleGetSessionMsg } from "./ws-event/GetSessionMsg.js"
import { ensureInternalRouter, stopInternalRouter } from "./runtime/internal-router.js"
import type { InternalRouterRuntimeConfig } from "./runtime/config.js"

export type WriteLog = (level: string, message: string, extra?: Record<string, unknown>) => Promise<void>

export type ManagerInstance = {
  ctx: any
  query: () => Record<string, unknown>
  v2client: OpencodeClient
  writeLog: WriteLog
  GetCurrentClientInfo: () => Promise<Record<string, unknown>>
  WaitForSessionExecutionStart: (sessionID: string) => Promise<{ ok: boolean; error?: string }>
  resolveInstanceWorkspaceInfo: () => { instanceWorkspaceDirectory: string; title: string } | null
  sendRequestionResolved: (payload: Record<string, unknown>) => boolean
  getSessionID: () => string
}

type State = {
  client: GlassveinWsClient | null
  instances: Map<string, ManagerInstance>
  instanceMcpMetadata: Map<string, Array<{ name: string; sourceID: string; metadata: Record<string, unknown> }>>
  runtimeID: string
  routerUrl: string
  status: "connecting" | "connected" | "disconnected"
  lastError: string
  writeLog: WriteLog
  starting: Promise<void> | null
  internalRouterStarted: boolean
}

const state: State = {
  client: null,
  instances: new Map(),
  instanceMcpMetadata: new Map(),
  runtimeID: "",
  routerUrl: "",
  status: "disconnected",
  lastError: "",
  writeLog: async (level, message, extra = {}) => {
    process.stderr.write(`${JSON.stringify({ time: new Date().toISOString(), level, message, extra })}\n`)
  },
  starting: null,
  internalRouterStarted: false,
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

async function syncTuiStatus(input: {
  status: "connecting" | "connected" | "disconnected"
  lastError?: string
  ctx?: any
}) {
  state.status = input.status
  if (input.lastError !== undefined) {
    state.lastError = text(input.lastError)
  } else if (input.status === "connected") {
    state.lastError = ""
  }
}

/**
 * Find the best matching instance for a control command.
 *
 * 只按 sessionID / instanceWorkspaceDirectory / displayID 定位，
 * 不再依赖 permissionID / questionID route map。
 */
function resolveInstanceForCommand(payload: Record<string, unknown>): ManagerInstance | null {
  const bindings = [...state.instances.entries()].map(([key, instance]) => {
    const query = readRecord(instance.query?.())
    const info = instance.resolveInstanceWorkspaceInfo?.() || null
    return {
      key,
      instance,
      instanceWorkspaceDirectory: text(info?.instanceWorkspaceDirectory),
      sessionID: text(instance.getSessionID?.()),
      displayID: text(query.displayID),
    }
  })

  if (bindings.length === 0) return null
  if (bindings.length === 1) return bindings[0].instance

  const routeSessionID = text(payload.sessionID)
  const routeDirectory = text(payload.instanceWorkspaceDirectory)
  const routeDisplayID = text(payload.displayID)

  let candidates = bindings
  if (routeDirectory) {
    candidates = candidates.filter((b) => b.instanceWorkspaceDirectory === routeDirectory)
  }
  if (routeDisplayID) {
    candidates = candidates.filter((b) => b.displayID === routeDisplayID)
  }
  if (routeSessionID) {
    const direct = candidates.filter((b) => b.sessionID === routeSessionID)
    if (direct.length === 1) return direct[0].instance
  }

  return candidates.length === 1 ? candidates[0].instance : null
}

export const VeinManager = {
  register(key: string, instance: ManagerInstance) {
    state.instances.set(key, instance)
  },
  unregister(key: string) {
    state.instances.delete(key)
    state.instanceMcpMetadata.delete(key)
    if (state.instances.size === 0) {
      state.client?.disconnect()
      if (state.internalRouterStarted) {
        stopInternalRouter(state.writeLog)
        state.internalRouterStarted = false
      }
      state.client = null
      state.runtimeID = ""
      state.routerUrl = ""
      void syncTuiStatus({ status: "disconnected", lastError: "" })
    }
  },
  async start(owner: ManagerInstance, config: Omit<GlassveinClientConfig, "nodeId"> & { nodeId?: string; internalRouter?: InternalRouterRuntimeConfig }) {
    if (!state.starting && !state.client) {
      state.starting = (async () => {
        const nodeId = config.nodeId || text(owner.ctx?.directory).split(/[\\/]/).filter(Boolean).pop() || "unknown"
        const runtime = config.runtime || nodeId
        state.runtimeID = runtime
        if (config.internalRouter) {
          const internalRouter = {
            ...config.internalRouter,
            trustedAnnouncePeers: [...new Set([
              nodeId,
              ...config.internalRouter.trustedAnnouncePeers,
            ].map(text).filter(Boolean))],
          }
          const internal = await ensureInternalRouter(internalRouter, state.writeLog)
          state.internalRouterStarted = internal.enabled
          state.routerUrl = internal.routerUrl
        } else {
          state.routerUrl = config.routerUrl
        }
        await syncTuiStatus({ status: "connecting", ctx: owner.ctx })

        const client = new GlassveinWsClient({
          ...config,
          routerUrl: state.routerUrl,
          nodeId,
          runtime,
        })

        client.on("connected", () => {
          void syncTuiStatus({ status: "connected", lastError: "" })
        })

        client.on("disconnected", () => {
          void syncTuiStatus({ status: "connecting", lastError: "connection closed" })
        })

        client.on("error", (error: Error) => {
          void syncTuiStatus({ status: "connecting", lastError: error.message })
        })

        // Control command handler — routes to the correct instance via handleServerEvent
        client.onControlCommand(async (command) => {
          const payload = readRecord(command.payload)
          const item = resolveInstanceForCommand(payload)
          if (!item) {
            void state.writeLog("warn", "control command: instance not found", { subtype: command.subtype })
            return { ok: false, accepted: false, error: "target instance not found", subtype: command.subtype }
          }

          try {
            const result = await handleServerEvent(
              { type: "control", subtype: command.subtype, data: payload },
              {
                ctx: item.ctx,
                query: item.query,
                v2client: item.v2client,
                runtimeID: state.runtimeID,
                GetCurrentClientInfo: () => item.GetCurrentClientInfo(),
                WaitForSessionExecutionStart: (sessionID: string) => item.WaitForSessionExecutionStart(sessionID),
                resolveInstanceWorkspaceInfo: () => item.resolveInstanceWorkspaceInfo(),
                sendRequestionResolved: (payload: Record<string, unknown>) => item.sendRequestionResolved(payload),
                connectionState: {
                  status: state.status,
                  lastError: state.lastError,
                  routerUrl: state.routerUrl,
                },
              },
            )
            void state.writeLog("info", "control command handled", { subtype: command.subtype, result })
            return result
          } catch (error) {
            void state.writeLog("error", "control command failed", {
              subtype: command.subtype,
              error: error instanceof Error ? error.message : String(error),
            })
            return { ok: false, accepted: false, subtype: command.subtype, error: error instanceof Error ? error.message : String(error) }
          }
        })

        // Request handler — responds to canonical OSGP request envelopes.
        client.onRequest(async (request) => {
          const { subtype, payload } = request
          void state.writeLog("info", "request received", { subtype, payload })

          // Use the first instance's context for snapshot queries
          // (snapshot queries are not instance-specific)
          const firstInstance = [...state.instances.values()][0]
          if (!firstInstance) {
            return { ok: false, error: "no instance registered" }
          }

          try {
            if (subtype === "runtime_session_messages") {
              return await handleGetSessionMsg(firstInstance.v2client, firstInstance.query, state.runtimeID, payload)
            }
            return await handleSnapshotReadRequest(firstInstance.ctx, subtype, payload)
          } catch (error) {
            void state.writeLog("error", "request failed", {
              subtype,
              error: error instanceof Error ? error.message : String(error),
            })
            return { error: error instanceof Error ? error.message : String(error) }
          }
        })

        await client.connect()
        state.client = client
        await state.writeLog("info", "vein client started", { routerUrl: state.routerUrl, nodeId, runtime, internalRouter: Boolean(config.internalRouter?.enabled) })
      })().finally(() => {
        state.starting = null
      })
    }

    if (state.starting) await state.starting
    await syncTuiStatus({ status: state.status, lastError: state.lastError, ctx: owner.ctx })
    return { runtimeID: state.runtimeID, routerUrl: state.routerUrl, writeLog: state.writeLog }
  },
  /**
   * Upload an OSGP event with a canonical UploadSubtype.
   * All outbound business events go through this single path.
   */
  upload(subtype: UploadSubtype, payload: Record<string, unknown>): boolean {
    if (!state.client) return false
    return state.client.sendUploadEvent(subtype, payload)
  },
  announceSession(sessionID: string): boolean {
    const clean = text(sessionID)
    if (!state.client || !state.runtimeID || !clean) return false
    const source = state.client.getSourceAddress()
    return state.client.sendAddressRegister({
      domain: source.domain,
      runtime: state.runtimeID,
      session: clean,
    })
  },
  reject(reason: string, ctx?: any) {
    void syncTuiStatus({ status: "disconnected", lastError: reason, ctx })
  },
  reportTuiStatus(ctx?: any) {
    return syncTuiStatus({ status: state.status, lastError: state.lastError, ctx })
  },
  rememberInstanceMcpMetadata(directory: string, entries: Array<{ name: string; sourceID: string; metadata?: Record<string, unknown> }>) {
    const clean = text(directory)
    if (!clean) return
    const seen = new Set<string>()
    const next = (Array.isArray(entries) ? entries : [])
      .filter((e) => e && text(e.name) && text(e.sourceID))
      .map((e) => ({
        name: text(e.name),
        sourceID: text(e.sourceID),
        metadata: e.metadata || {},
      }))
      .filter((e) => {
        const k = `${e.name}::${e.sourceID}`
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
    state.instanceMcpMetadata.set(clean, next)
  },
}
