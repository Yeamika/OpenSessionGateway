/**
 * GvOpencodeInstanceClient — per-directory instance for GlassVein opencode plugin.
 *
 * OSGP upload-only wire contract:
 *   - session_update: sessionID + state + compact metadata
 *   - requestion_asked: unified permission/question with sessionID + requestID
 *   - requestion_resolved: answered/rejected/failed
 *
 * No client.content.executing, no deprecated sendOpencodeEvent.
 * All uploads go through VeinManager.upload() → sendUploadEvent() → OSGP createUpload.
 */

import {
  applyEventToCurrentClientInfo,
  createInitialCurrentClientInfo,
  getCurrentClientInfoSnapshot,
  type CurrentClientInfo,
} from "./current-client-info.js"
import {
  type ClientSessionState,
  type ClientSessionReason,
} from "./types.js"
import {
  createSessionStateStore,
  type SessionStateStore,
  handleSessionStatus,
  handleSessionIdle,
  handleSessionCreated,
  handleSessionDeleted,
  handleSessionError,
  handleSessionCompacted,
  handleMessagePartUpdated,
  handleTuiSessionSelect,
  type SessionUpdatePayload,
} from "./session-state.js"
import { refreshSessionTitle } from "./runtime/refresh-session-title.js"
import { VeinManager, type WriteLog, type ManagerInstance } from "./vein-manager.js"
import { buildPermissionAskedPayload } from "./ws-event/Permission.js"
import { buildQuestionAskedPayload, buildQuestionUpdatedPayload } from "./ws-event/Question.js"
import { buildVeinRuntimeConfig, readVeinEnvOverrides, writeVeinConfig } from "./runtime/config.js"
import { updateSessionState } from "./ws-event/Snapshot.js"
import { type OpencodeClient } from "@opencode-ai/sdk/v2"

// ── Helpers ───────────────────────────────────────────────────────────

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

// ── Execution waiters ─────────────────────────────────────────────────

type ExecutionWaiter = {
  resolve: (value: { ok: boolean; error?: string }) => void
  timeout: ReturnType<typeof setTimeout>
}

// ── GvOpencodeInstanceClient ──────────────────────────────────────────

export class GvOpencodeInstanceClient {
  private readonly ctx: any
  private readonly query: () => Record<string, unknown>
  private readonly v2client: OpencodeClient
  private readonly currentClientInfo: CurrentClientInfo
  private readonly sessionStore: SessionStateStore
  private readonly executionWaiters: Map<string, ExecutionWaiter[]>
  private lastUploadedSessionKey: string
  private runtimeIDForMcp: string
  private routerUrlForMcp: string
  writeLog: WriteLog

  constructor(ctx: any, query: () => Record<string, unknown>, v2client: OpencodeClient) {
    this.ctx = ctx
    this.query = query
    this.v2client = v2client
    this.currentClientInfo = createInitialCurrentClientInfo(ctx?.directory)
    this.sessionStore = createSessionStateStore()
    this.executionWaiters = new Map()
    this.lastUploadedSessionKey = ""
    this.runtimeIDForMcp = ""
    this.routerUrlForMcp = ""
    this.writeLog = async (level, message, extra = {}) => {
      process.stderr.write(`${JSON.stringify({ time: new Date().toISOString(), level, message, extra })}\n`)
    }
  }

  // ── Key / identity ─────────────────────────────────────────────────

  private key(): string {
    const dir = typeof this.ctx?.directory === "string" ? this.ctx.directory.trim() : ""
    if (!dir) throw new Error("ctx.directory is required")
    return dir
  }

  getSessionID(): string {
    return this.currentClientInfo.sessionID || ""
  }

  // ── CurrentClientInfo ──────────────────────────────────────────────

  async GetCurrentClientInfo(): Promise<Record<string, unknown>> {
    const q = this.query()
    return {
      runtimeID: this.runtimeIDForMcp || "unknown",
      displayID: q && typeof q.displayID === "string" ? q.displayID : undefined,
      ...getCurrentClientInfoSnapshot(this.currentClientInfo),
    }
  }

  // ── Session title refresh ──────────────────────────────────────────

  private async refreshCurrentSessionTitle(): Promise<void> {
    const sessionID = text(this.currentClientInfo.sessionID)
    if (!sessionID) return
    const directory = text(this.currentClientInfo.cwd) || undefined
    const title = await refreshSessionTitle(this.v2client, this.query, sessionID, directory)
    if (title) this.currentClientInfo.sessionTitle = title
  }

  // ── Instance workspace ─────────────────────────────────────────────

  resolveInstanceWorkspaceInfo(): { instanceWorkspaceDirectory: string; title: string } | null {
    const cwd = text(this.currentClientInfo.cwd)
    if (!cwd || cwd === "/") return null
    const title = cwd.split(/[\\/]/).filter(Boolean).pop() || ""
    return { instanceWorkspaceDirectory: cwd, title }
  }

  // ── Execution waiters ──────────────────────────────────────────────

  private settleWaiters(sessionID: string, result: { ok: boolean; error?: string }) {
    const clean = text(sessionID)
    const waiters = this.executionWaiters.get(clean)
    if (!waiters) return
    this.executionWaiters.delete(clean)
    for (const w of waiters) {
      clearTimeout(w.timeout)
      w.resolve(result)
    }
  }

  private resolveExecutionWaiters(event: unknown) {
    const src = record(event)
    const type = text(src.type)
    if (type !== "message.updated" && type !== "message.part.updated") return
    const props = record(src.properties)
    const part = record(props.part)
    const partType = text(part.type)
    const sessionID = text(props.sessionID)
    if (!sessionID) return
    if (type === "message.updated" || partType === "text" || partType === "step-finish") {
      this.settleWaiters(sessionID, { ok: true })
    }
  }

  WaitForSessionExecutionStart(sessionID: string): Promise<{ ok: boolean; error?: string }> {
    const clean = text(sessionID)
    if (!clean) return Promise.resolve({ ok: false, error: "empty sessionID" })
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        const waiters = this.executionWaiters.get(clean)
        if (waiters) {
          this.executionWaiters.delete(clean)
          resolve({ ok: false, error: "timeout" })
        }
      }, 30_000)
      let waiters = this.executionWaiters.get(clean)
      if (!waiters) {
        waiters = []
        this.executionWaiters.set(clean, waiters)
      }
      waiters.push({ resolve, timeout })
    })
  }

  // ── OSGP wire helpers ──────────────────────────────────────────────

  /** Upload session_update (deduplicated by key) */
  private uploadSessionUpdate(
    sessionID: string,
    title?: string,
    force = false,
  ): boolean {
    const clean = text(sessionID)
    if (!clean) return false

    const row = this.sessionStore.get(clean)

    // Dedup key
    const key = [clean, row?.state || "", row?.reason || "", row?.extraInfo || ""].join("|")
    if (!force && key === this.lastUploadedSessionKey) return false
    this.lastUploadedSessionKey = key

    const state = row?.state || "idle"
    const metadata = row?.reason || row?.extraInfo
      ? {
        ...(row?.reason ? { reason: row.reason } : {}),
        ...(row?.extraInfo ? { extraInfo: row.extraInfo } : {}),
      }
      : undefined
    const payload: Record<string, unknown> = {
      sessionID: clean,
      state,
    }
    if (metadata) payload.metadata = metadata

    updateSessionState(clean, state, row?.reason || null, metadata || null)

    return VeinManager.upload("session_update", payload)
  }

  /** Upload requestion_resolved — used by control command handler */
  sendRequestionResolved(payload: Record<string, unknown>): boolean {
    return VeinManager.upload("requestion_resolved", payload)
  }

  // ── Session state → CurrentClientInfo sync ─────────────────────────

  private syncSessionStateToClientInfo(sessionID: string) {
    const row = this.sessionStore.get(sessionID)
    if (!row) return
    const stateMap: Record<string, ClientSessionState> = {
      idle: "idle", busy: "busy", waiting: "waiting", stopped: "stopped",
    }
    this.currentClientInfo.sessionState = stateMap[row.state] ?? null
    const reasonMap: Record<string, ClientSessionReason> = {
      pending: "pending", completed: "completed", tool: "tool",
      generating: "generating", reasoning: "reasoning", compacting: "compacting",
      requestion: "question", aborted: "aborted", error: "error",
    }
    this.currentClientInfo.sessionReason = row.reason
      ? (reasonMap[row.reason] ?? null)
      : null
  }

  // ── Main event handler ─────────────────────────────────────────────

  async onEvent(event: any) {
    this.resolveExecutionWaiters(event)

    const previousSessionID = this.currentClientInfo.sessionID
    const previousTitle = this.currentClientInfo.sessionTitle

    const type = event && typeof event === "object" && typeof event.type === "string" ? event.type : ""
    const props = event && typeof event === "object" && event.properties && typeof event.properties === "object"
      ? event.properties as Record<string, unknown> : {}
    const eventSessionID = text(props.sessionID)

    // 1. Apply to CurrentClientInfo (OSG parity: cwd, sessionID, title, status)
    const result = applyEventToCurrentClientInfo(this.currentClientInfo, event)

    // 2. Direct session state tracking
    let sessionUpdate: SessionUpdatePayload | null = null

    if (type === "session.status" && eventSessionID) {
      sessionUpdate = handleSessionStatus(props, eventSessionID, this.sessionStore)
    } else if (type === "session.idle" && eventSessionID) {
      sessionUpdate = handleSessionIdle(eventSessionID, this.sessionStore)
    } else if (type === "session.created" && eventSessionID) {
      handleSessionCreated(eventSessionID, this.sessionStore)
    } else if (type === "session.deleted" && eventSessionID) {
      sessionUpdate = handleSessionDeleted(eventSessionID, this.sessionStore)
    } else if (type === "session.error" && eventSessionID) {
      sessionUpdate = handleSessionError(props, eventSessionID, this.sessionStore)
    } else if (type === "session.compacted" && eventSessionID) {
      sessionUpdate = handleSessionCompacted(eventSessionID, this.sessionStore)
    } else if (type === "message.part.updated" && eventSessionID) {
      sessionUpdate = handleMessagePartUpdated(props, eventSessionID, this.sessionStore)
    } else if (type === "tui.session.select") {
      handleTuiSessionSelect(props, this.sessionStore)
    }

    // 3. Sync session state → CurrentClientInfo
    const currentSessionID = text(this.currentClientInfo.sessionID)
    if (currentSessionID) this.syncSessionStateToClientInfo(currentSessionID)

    const nextTitle = this.currentClientInfo.sessionTitle

    // 4. Upload session_update (OSGP)
    //    After state change, title change, or session switch
    if (sessionUpdate) {
      // State change from handlers — force upload
      this.uploadSessionUpdate(currentSessionID || eventSessionID, nextTitle || undefined, true)
    } else if (currentSessionID && (
      result.selected
      || currentSessionID !== previousSessionID
      || nextTitle !== previousTitle
    )) {
      this.uploadSessionUpdate(currentSessionID, nextTitle || undefined)
    }

    // 5. Unified requestion_asked upload (OSGP)
    if (type === "permission.asked") {
      const permissionPayload = buildPermissionAskedPayload({
        event: event && typeof event === "object" ? event as Record<string, unknown> : { type, properties: props },
        currentClientInfo: this.currentClientInfo,
        instanceWorkspace: this.resolveInstanceWorkspaceInfo(),
        query: this.query,
      })
      if (permissionPayload) {
        VeinManager.upload("requestion_asked", permissionPayload)
      }
    }
    if (type === "question.asked") {
      const questionPayload = buildQuestionAskedPayload({
        event: event && typeof event === "object" ? event as Record<string, unknown> : { type, properties: props },
        query: this.query,
      })
      if (questionPayload) {
        VeinManager.upload("requestion_asked", questionPayload)
      }
    }
    if (type === "question.replied" || type === "question.rejected") {
      const questionUpdatedPayload = buildQuestionUpdatedPayload({
        event: event && typeof event === "object" ? event as Record<string, unknown> : {},
        status: type === "question.replied" ? "answered" : "rejected",
      })
      if (questionUpdatedPayload) {
        VeinManager.upload("requestion_updated", questionUpdatedPayload)
      }
    }
    if (type === "question.cancelled") {
      const questionCancelledPayload = buildQuestionUpdatedPayload({
        event: event && typeof event === "object" ? event as Record<string, unknown> : {},
        status: "cancelled",
      })
      if (questionCancelledPayload) {
        VeinManager.upload("requestion_cancelled", questionCancelledPayload)
      }
    }

    // 6. Seed execution waiters on session select/create
    if (result.selected || type === "session.created") {
      const seedID = result.selected ? currentSessionID : eventSessionID
      if (seedID) this.settleWaiters(seedID, { ok: true })
    }

    // 7. Refresh title if needed
    if (result.shouldRefreshTitle) {
      await this.refreshCurrentSessionTitle()
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  async start() {
    const instance: ManagerInstance = {
      ctx: this.ctx,
      query: this.query,
      v2client: this.v2client,
      writeLog: this.writeLog,
      GetCurrentClientInfo: () => this.GetCurrentClientInfo(),
      WaitForSessionExecutionStart: (sid) => this.WaitForSessionExecutionStart(sid),
      resolveInstanceWorkspaceInfo: () => this.resolveInstanceWorkspaceInfo(),
      sendRequestionResolved: (p) => this.sendRequestionResolved(p),
      getSessionID: () => this.getSessionID(),
    }
    VeinManager.register(this.key(), instance)

    const config = await buildVeinRuntimeConfig()
    const nodeId = this.key().split(/[\\/]/).filter(Boolean).pop() || "unknown"
    const result = await VeinManager.start(instance, {
      routerUrl: config.routerUrl,
      internalRouter: config.internalRouter,
      nodeId,
      domain: "opencode",
      runtime: config.runtimeID || nodeId,
    })
    this.runtimeIDForMcp = result.runtimeID
    this.routerUrlForMcp = result.routerUrl
    this.writeLog = result.writeLog
  }

  stop() {
    for (const [sessionID] of this.executionWaiters) {
      this.settleWaiters(sessionID, { ok: false, error: "client stopped" })
    }
    VeinManager.unregister(this.key())
  }

  // ── Config helpers ─────────────────────────────────────────────────

  getRuntimeID() { return this.runtimeIDForMcp }
  getRouterUrl() { return this.routerUrlForMcp }
  getInstanceWorkspaceDirectoryForMcp() { return this.key() }

  // ── TUI config helpers ─────────────────────────────────────────────

  async reportTuiStatus() {
    await VeinManager.reportTuiStatus(this.ctx)
  }

  async saveTuiConfig(payload?: { routerUrl?: string; runtimeID?: string }) {
    const envOverride = readVeinEnvOverrides()
    if (text(payload?.routerUrl) && envOverride.routerUrl) {
      throw new Error("GV_ROUTER_URL / OSG_WS_URL is set in environment; clear it before saving router URL")
    }
    if (text(payload?.runtimeID) && envOverride.runtimeID) {
      throw new Error("GV_RUNTIME_ID / OSG_RUNTIME_ID is set in environment; clear it before saving RuntimeID")
    }
    const saved = await writeVeinConfig(payload || {})
    if (text(saved.routerUrl)) this.routerUrlForMcp = saved.routerUrl as string
    if (text(saved.runtimeID)) this.runtimeIDForMcp = saved.runtimeID as string
  }
}
