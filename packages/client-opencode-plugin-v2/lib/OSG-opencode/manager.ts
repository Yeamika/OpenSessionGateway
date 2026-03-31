import WebSocket from "ws"
import fs from "node:fs"
import path from "node:path"
import { OSGClient } from "@opensessiongateway/client-library"
import {
  createClientContentExecuteingPayload,
  createWsEnvelope,
  PERMISSION_ASKED_EVENT,
  PERMISSION_UPDATED_EVENT,
  readPermissionUpdatedPayload,
} from "@opensessiongateway/protocol-library"
import type { ClientContentExecuteingPayload } from "@opensessiongateway/protocol-library/ws-protocol/ClientContentExecuteing.js"
import { buildOsgRuntimeConfig, DEFAULT_OSG_LOG_DIR } from "../config.js"
import { createClientContentExecuteingWs } from "./ws-event/ClientContentExecuteing.js"
import { handleServerEvent } from "./ServerEvent.js"
import { resolveTargetSessionContext } from "./runtime/target-context.js"

export type WriteLog = (level: string, message: string, extra?: Record<string, unknown>) => Promise<void>

export type ManagerInstance = {
  ctx: any
  query: () => Record<string, unknown>
  writeLog: WriteLog
  GetCurrentClientInfo: () => Promise<Record<string, unknown>>
  ListSession: (payload?: { list?: number; regex?: string }) => Promise<any>
  RequestInstanceWorkspaceReload: (payload?: { instanceWorkspaceDirectory?: string; title?: string }) => Promise<Record<string, unknown>>
  resolveInstanceWorkspaceInfo: () => { instanceWorkspaceDirectory: string; title: string } | null
  sendPermissionUpdated: (payload: Record<string, unknown>) => boolean
  reportClientContentExecuteing: (payload: {
    displayID?: string
    instanceWorkspaceDirectory?: string
    session?: { sessionID?: string; title?: string; status?: "idle" | "busy" | "error" }
  }, force?: boolean) => boolean
  getSessionID: () => string
}

type State = {
  client: OSGClient | null
  instances: Map<string, ManagerInstance>
  permissionRoutes: Map<string, { key: string; instanceWorkspaceDirectory: string; sessionID: string; displayID: string }>
  logFileStream: fs.WriteStream | null
  runtimeID: string
  wsServerUrl: string
  hostName: string
  writeLog: WriteLog
  starting: Promise<void> | null
}

const state: State = {
  client: null,
  instances: new Map(),
  permissionRoutes: new Map(),
  logFileStream: null,
  runtimeID: "",
  wsServerUrl: "",
  hostName: "",
  writeLog: async (level, message, extra = {}) => {
    process.stderr.write(`${JSON.stringify({ time: new Date().toISOString(), level, message, extra })}\n`)
  },
  starting: null,
}

async function wait(client: OSGClient | null, timeout = 5000) {
  const fn = (client as OSGClient & { waitConnected?: (timeoutMs?: number) => Promise<boolean> } | null)?.waitConnected
  if (!fn) return false
  return fn(timeout)
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function createLogStream() {
  return { write(line: unknown) { process.stderr.write(typeof line === "string" ? line : String(line || "")) } }
}

function createNullLogStream() {
  return { write() {} }
}

function createFileLogStream(logDir: string) {
  const dir = typeof logDir === "string" && logDir.trim() ? logDir.trim() : DEFAULT_OSG_LOG_DIR
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, `client-debug-${process.pid}.log`)
  return { stream: fs.createWriteStream(filePath, { flags: "a" }), filePath }
}

function createWriteLog(logger: any): WriteLog {
  return async (level, message, extra = {}) => {
    const method = level === "error" ? "error" : level === "warn" ? "warn" : "info"
    if (logger && typeof logger[method] === "function") {
      logger[method](message, extra)
      return
    }
    process.stderr.write(`${JSON.stringify({ time: new Date().toISOString(), level, message, extra })}\n`)
  }
}

type InstanceBinding = {
  key: string
  instance: ManagerInstance
  instanceWorkspaceDirectory: string
  sessionID: string
  displayID: string
}

type MessageRoute = {
  instanceWorkspaceDirectory: string
  sessionID: string
  displayID: string
  permissionID: string
}

function instanceBindings(): InstanceBinding[] {
  return [...state.instances.entries()].map(([key, instance]) => {
    const query = readRecord(instance.query?.())
    const instanceWorkspaceInfo = instance.resolveInstanceWorkspaceInfo?.() || null
    return {
      key,
      instance,
      instanceWorkspaceDirectory: text(instanceWorkspaceInfo?.instanceWorkspaceDirectory),
      sessionID: text(instance.getSessionID?.()),
      displayID: text(query.displayID),
    }
  })
}

function readMessageRoute(message?: unknown): MessageRoute {
  const src = readRecord(message)
  const data = readRecord(src.data)
  return {
    instanceWorkspaceDirectory: text(data.instanceWorkspaceDirectory),
    sessionID: text(data.sessionID),
    displayID: text(data.displayID),
    permissionID: text(data.permissionID),
  }
}

function hasExplicitRoute(route: MessageRoute): boolean {
  return Boolean(route.instanceWorkspaceDirectory || route.sessionID || route.displayID || route.permissionID)
}

function filterBindings(bindings: InstanceBinding[], route: Pick<MessageRoute, "instanceWorkspaceDirectory" | "displayID">): InstanceBinding[] {
  return bindings.filter((item) => {
    if (route.instanceWorkspaceDirectory && item.instanceWorkspaceDirectory !== route.instanceWorkspaceDirectory) return false
    if (route.displayID && item.displayID !== route.displayID) return false
    return true
  })
}

function chooseBinding(bindings: InstanceBinding[]): InstanceBinding | null {
  return bindings.length === 1 ? bindings[0] : null
}

function readPermissionRoute(permissionID: string): { instanceWorkspaceDirectory: string; sessionID: string; displayID: string } | null {
  const cleanPermissionID = text(permissionID)
  if (!cleanPermissionID) return null
  const route = state.permissionRoutes.get(cleanPermissionID)
  if (!route) return null
  return {
    instanceWorkspaceDirectory: route.instanceWorkspaceDirectory,
    sessionID: route.sessionID,
    displayID: route.displayID,
  }
}

async function resolveSessionRoute(sessionID: string, bindings: InstanceBinding[]): Promise<{ instanceWorkspaceDirectory: string } | null> {
  const cleanSessionID = text(sessionID)
  if (!cleanSessionID) return null

  const seen = new Set<string>()
  const matches = new Map<string, { instanceWorkspaceDirectory: string }>()
  for (const item of bindings) {
    if (!item.instanceWorkspaceDirectory) continue
    const directoryKey = item.instanceWorkspaceDirectory
    if (seen.has(directoryKey)) continue
    seen.add(directoryKey)
    const route = await resolveTargetSessionContext(item.instance.ctx, cleanSessionID)
    if (!route) continue
    matches.set(route.instanceWorkspaceDirectory, route)
  }

  if (matches.size !== 1) return null
  return [...matches.values()][0]
}

async function resolveMessageInstance(message?: unknown): Promise<ManagerInstance | null> {
  const bindings = instanceBindings()
  if (bindings.length === 0) return null

  const route = readMessageRoute(message)
  const permissionRoute = readPermissionRoute(route.permissionID)
  if (route.permissionID && !permissionRoute && !route.instanceWorkspaceDirectory && !route.sessionID && !route.displayID) {
    return null
  }
  const effectiveRoute: MessageRoute = permissionRoute
      ? {
        instanceWorkspaceDirectory: permissionRoute.instanceWorkspaceDirectory,
        sessionID: permissionRoute.sessionID,
        displayID: permissionRoute.displayID,
        permissionID: route.permissionID,
      }
    : route

  if (!hasExplicitRoute(effectiveRoute)) {
    return null
  }

  let candidates = filterBindings(bindings, effectiveRoute)
  if (effectiveRoute.sessionID) {
    const direct = candidates.filter((item) => item.sessionID === effectiveRoute.sessionID)
    const directMatch = chooseBinding(direct)
    if (directMatch) return directMatch.instance

    const resolved = await resolveSessionRoute(effectiveRoute.sessionID, candidates)
    if (!resolved) return null
    if (effectiveRoute.instanceWorkspaceDirectory && effectiveRoute.instanceWorkspaceDirectory !== resolved.instanceWorkspaceDirectory) return null
    candidates = filterBindings(candidates, {
      instanceWorkspaceDirectory: resolved.instanceWorkspaceDirectory,
      displayID: effectiveRoute.displayID,
    })
  }

  return chooseBinding(candidates)?.instance || null
}

function rememberPermissionRoute(key: string, payload: Record<string, unknown>) {
  const permissionID = text(payload.permissionID)
  if (!permissionID) return
  const binding = instanceBindings().find((item) => item.key === key)
  if (!binding || !binding.instanceWorkspaceDirectory) return
  state.permissionRoutes.set(permissionID, {
    key,
    instanceWorkspaceDirectory: binding.instanceWorkspaceDirectory,
    sessionID: text(payload.sessionID),
    displayID: text(payload.displayID),
  })
}

function forgetPermissionRoute(payload: Record<string, unknown>) {
  const update = readPermissionUpdatedPayload(payload)
  if (!update.permissionID) return
  if (update.status === "created" || update.status === "pending") return
  state.permissionRoutes.delete(update.permissionID)
}

function normalizeSessionStatus(value: unknown): "idle" | "busy" | "error" | undefined {
  const status = text(value)
  if (status === "Idle") return "idle"
  if (status === "Interrupted") return "error"
  if (status) return "busy"
  return undefined
}

async function reportAllInstanceStates() {
  for (const item of state.instances.values()) {
    const info = await item.GetCurrentClientInfo().catch(() => null)
    const src = readRecord(info)
    const payload = createClientContentExecuteingPayload({
      displayID: text(src.displayID) || undefined,
      instanceWorkspaceDirectory: text(src.cwd) || undefined,
      session: {
        sessionID: text(src.sessionID) || undefined,
        title: text(src.sessionTitle) || undefined,
        status: normalizeSessionStatus(src.status),
      },
    })
    if (payload.instanceWorkspaceDirectory || payload.displayID || payload.session) {
      OsgManager.report(payload)
    }
  }
}

function showToastOnAllInstances(type: string, message: string, subtitle?: string) {
  for (const item of state.instances.values()) {
    void item.ctx.client.tui.showToast({
      body: { title: `OSG-${subtitle || "status"}`, message, variant: type === "success" ? "success" : type === "error" ? "error" : "info", duration: 3000 },
      query: item.query(),
    }).catch(() => {})
  }
}

export const OsgManager = {
  register(key: string, instance: ManagerInstance) {
    state.instances.set(key, instance)
  },
  unregister(key: string) {
    state.instances.delete(key)
    for (const [permissionID, route] of [...state.permissionRoutes.entries()]) {
      if (route.key === key) {
        state.permissionRoutes.delete(permissionID)
      }
    }
    if (state.instances.size === 0) {
      state.client?.stop()
      state.client = null
      state.permissionRoutes.clear()
      if (state.logFileStream) {
        try { state.logFileStream.end() } catch {}
        state.logFileStream = null
      }
      state.runtimeID = ""
      state.wsServerUrl = ""
      state.hostName = ""
    }
  },
  async start(owner: ManagerInstance) {
    if (!state.starting && !state.client) {
      state.starting = (async () => {
        const { wsServerUrl, runtimeID, hostName, logDir } = await buildOsgRuntimeConfig(owner.ctx)
        state.runtimeID = runtimeID
        state.wsServerUrl = wsServerUrl
        state.hostName = hostName

        let logStream = createLogStream()
        try {
          const file = createFileLogStream(logDir)
          logStream = file.stream
          state.logFileStream = file.stream
        } catch {
          try {
            const file = createFileLogStream(DEFAULT_OSG_LOG_DIR)
            logStream = file.stream
            state.logFileStream = file.stream
          } catch {
            logStream = createNullLogStream()
          }
        }

        state.client = new OSGClient(
          { wsServerUrl, runtimeID, hostName, logStream, WebSocketImpl: WebSocket as unknown as new (url: string) => any },
          {
            onOpen: () => {
              void reportAllInstanceStates()
            },
            showToast: (type, message, subtitle) => {
              showToastOnAllInstances(type, message, subtitle)
            },
            onServerEvent: async (message: unknown) => {
              const item = await resolveMessageInstance(message)
              if (!item) return { accepted: false, error: "instance not found" }
              return handleServerEvent(message, {
                ctx: item.ctx,
                query: item.query,
                runtimeID: state.runtimeID,
                GetCurrentClientInfo: () => item.GetCurrentClientInfo(),
                ListSession: (payload?: { list?: number; regex?: string }) => item.ListSession(payload),
                RequestInstanceWorkspaceReload: (payload?: { instanceWorkspaceDirectory?: string; title?: string }) => item.RequestInstanceWorkspaceReload(payload),
                resolveInstanceWorkspaceInfo: () => item.resolveInstanceWorkspaceInfo(),
                resolvePermissionRoute: (permissionID: string) => readPermissionRoute(permissionID),
                sendPermissionUpdated: (payload: Record<string, unknown>) => item.sendPermissionUpdated(payload),
                reportClientContentExecuteing: (payload, force) => item.reportClientContentExecuteing(payload, force),
              })
            },
          },
        )
        state.writeLog = createWriteLog(state.client.logger)
        state.client.start()
        await state.writeLog("info", "osg plugin connecting", { wsServerUrl, runtimeID, hostName })
        const ok = await wait(state.client, 5000)
        if (!ok) {
          await state.writeLog("warn", "osg plugin connection wait timed out", {
            timeoutMs: 5000,
            wsServerUrl,
            runtimeID,
          })
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }
        await state.writeLog("info", "osg client started", { wsServerUrl, runtimeID, hostName })
      })().finally(() => {
        state.starting = null
      })
    }

    if (state.starting) await state.starting
    return { runtimeID: state.runtimeID, wsServerUrl: state.wsServerUrl, hostName: state.hostName, writeLog: state.writeLog }
  },
  report(payload: ClientContentExecuteingPayload) {
    if (!state.client) return false
    return state.client.send(createClientContentExecuteingWs(payload))
  },
  sendPermissionAsked(key: string, payload: Record<string, unknown>) {
    rememberPermissionRoute(key, payload)
    return OsgManager.sendEvent(PERMISSION_ASKED_EVENT, payload)
  },
  sendEvent(type: string, data: unknown) {
    if (!state.client) return false
    const eventType = typeof type === "string" ? type.trim() : ""
    if (!eventType) return false
    if (eventType === PERMISSION_UPDATED_EVENT) {
      forgetPermissionRoute(readRecord(data))
    }
    return state.client.send(createWsEnvelope({
      type: eventType,
      requestID: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      data,
    }))
  },
}
