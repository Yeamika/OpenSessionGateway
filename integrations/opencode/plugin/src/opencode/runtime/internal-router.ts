/**
 * Server-level internal GlassVein router lifecycle for the opencode plugin.
 *
 * The opencode server plugin owns at most one local router process. Workspace
 * instances connect to that router; they must not spawn routers per session.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import WebSocket from "ws"
import type { InternalRouterRuntimeConfig } from "./config.js"
import type { WriteLog } from "../vein-manager.js"

type RouterState = {
  child: ChildProcessWithoutNullStreams | null
  key: string
  starting: Promise<InternalRouterStartResult> | null
}

export type InternalRouterStartResult = {
  enabled: boolean
  started: boolean
  routerUrl: string
  pid?: number
}

const state: RouterState = {
  child: null,
  key: "",
  starting: null,
}

const targets: Record<string, [string, string]> = {
  "win32:x64": ["win32-x64", "glassvein-router.exe"],
  "linux:x64": ["linux-x64", "glassvein-router"],
  "linux:arm64": ["linux-arm64", "glassvein-router"],
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function routerKey(config: InternalRouterRuntimeConfig): string {
  return JSON.stringify({
    nodeId: config.nodeId,
    bindAddr: config.bindAddr,
    upstreamUrls: config.upstreamUrls,
    binaryPath: config.binaryPath,
    stateFilePath: config.stateFilePath,
    trustedAnnouncePeers: config.trustedAnnouncePeers,
  })
}

export function resolveGlassVeinRouterBinary(explicit = ""): string {
  const direct = text(explicit) || text(process.env.GLASSVEIN_ROUTER_BINARY)
  if (direct) return direct

  const key = `${process.platform}:${process.arch}`
  const target = targets[key]
  if (!target) {
    const supported = Object.keys(targets).join(", ")
    throw new Error(`unsupported router binary target ${key}; supported: ${supported}`)
  }

  const require = createRequire(import.meta.url)
  const packageJson = require.resolve("@opensessiongateway/glassvein-router/package.json")
  return path.join(path.dirname(packageJson), "dist", target[0], target[1])
}

export function buildInternalRouterArgs(config: InternalRouterRuntimeConfig): string[] {
  const args = [
    "--node-id", config.nodeId,
    "--bind-addr", config.bindAddr,
  ]
  for (const url of config.upstreamUrls) {
    if (text(url)) args.push("--upstream-url", text(url))
  }
  if (text(config.stateFilePath)) args.push("--state-file", text(config.stateFilePath))
  return args
}

function routerStateBase(config: InternalRouterRuntimeConfig): Record<string, unknown> {
  return {
    schema_version: 1,
    node_id: config.nodeId,
    updated_at: new Date().toISOString(),
    route_revision: 0,
    rule_revision: 0,
    permission_revision: 0,
    manual_routes: [],
    rules: [],
    persistent_grants: [],
    audit_log: [],
  }
}

function readRouterStateFile(filePath: string, config: InternalRouterRuntimeConfig): Record<string, unknown> {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"))
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : routerStateBase(config)
  } catch {
    return routerStateBase(config)
  }
}

function grantKey(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ""
  const src = value as Record<string, unknown>
  const peer = text(src.peer_id)
  const op = text(src.op)
  return peer && op ? `${peer}::${op}` : ""
}

export function ensureInternalRouterStateFile(config: InternalRouterRuntimeConfig): string {
  const filePath = text(config.stateFilePath)
  if (!filePath) return ""
  const state = readRouterStateFile(filePath, config)
  const peers = [...new Set(config.trustedAnnouncePeers.map(text).filter(Boolean))]
  const current = Array.isArray(state.persistent_grants) ? state.persistent_grants : []
  const seen = new Set(current.map(grantKey).filter(Boolean))
  const grants = [...current]
  for (const peer of peers) {
    const key = `${peer}::announce_route`
    if (seen.has(key)) continue
    seen.add(key)
    grants.push({
      peer_id: peer,
      op: "announce_route",
      kind: "persist",
    })
  }
  const next = {
    ...routerStateBase(config),
    ...state,
    node_id: text(state.node_id) || config.nodeId,
    updated_at: new Date().toISOString(),
    persistent_grants: grants,
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8")
  return filePath
}

function waitForRouter(host: string, port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  const connectHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host
  const printableHost = connectHost.includes(":") && !connectHost.startsWith("[") ? `[${connectHost}]` : connectHost
  const url = `ws://${printableHost}:${port}`

  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const ws = new WebSocket(url)
      let settled = false
      const done = (error?: Error) => {
        if (settled) return
        settled = true
        ws.removeAllListeners()
        try { ws.close(1000, "startup probe") } catch {}
        if (!error) return resolve()
        if (Date.now() >= deadline) return reject(error)
        setTimeout(tryOnce, 100)
      }
      const timeout = setTimeout(() => done(new Error(`timeout waiting for router ${url}`)), 500)
      ws.once("open", () => {
        clearTimeout(timeout)
        done()
      })
      ws.once("error", (error) => {
        clearTimeout(timeout)
        done(error instanceof Error ? error : new Error(String(error)))
      })
    }
    tryOnce()
  })
}

function pipeLogs(child: ChildProcessWithoutNullStreams, writeLog: WriteLog) {
  child.stdout.on("data", (chunk) => {
    for (const line of String(chunk).split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
      void writeLog("info", "internal router stdout", { line })
    }
  })
  child.stderr.on("data", (chunk) => {
    for (const line of String(chunk).split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
      void writeLog("warn", "internal router stderr", { line })
    }
  })
}

export async function ensureInternalRouter(
  config: InternalRouterRuntimeConfig,
  writeLog: WriteLog,
): Promise<InternalRouterStartResult> {
  if (!config.enabled) return { enabled: false, started: false, routerUrl: config.routerUrl }

  const key = routerKey(config)
  if (state.child && !state.child.killed && state.key === key) {
    return { enabled: true, started: false, routerUrl: config.routerUrl, pid: state.child.pid }
  }
  if (state.child && state.key !== key) {
    throw new Error("internal GlassVein router is already running with different server-level config; restart opencode to reconfigure")
  }
  if (state.starting) return state.starting

  state.starting = (async () => {
    const binary = resolveGlassVeinRouterBinary(config.binaryPath)
    ensureInternalRouterStateFile(config)
    const args = buildInternalRouterArgs(config)
    const child = spawn(binary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    })
    state.child = child
    state.key = key
    pipeLogs(child, writeLog)

    child.once("exit", (code, signal) => {
      const wasCurrent = state.child === child
      if (wasCurrent) {
        state.child = null
        state.key = ""
      }
      void writeLog(code === 0 ? "info" : "warn", "internal router exited", { code, signal })
    })
    child.once("error", (error) => {
      void writeLog("error", "internal router spawn failed", { error: error.message })
    })

    await waitForRouter(config.bindHost, config.port, config.startupTimeoutMs)
    await writeLog("info", "internal router started", {
      routerUrl: config.routerUrl,
      bindAddr: config.bindAddr,
      upstreamUrls: config.upstreamUrls,
      pid: child.pid,
    })
    return { enabled: true, started: true, routerUrl: config.routerUrl, pid: child.pid }
  })().finally(() => {
    state.starting = null
  })

  return state.starting
}

export function stopInternalRouter(writeLog: WriteLog): void {
  const child = state.child
  state.child = null
  state.key = ""
  if (!child || child.killed) return
  try {
    child.kill("SIGTERM")
    void writeLog("info", "internal router stop requested", { pid: child.pid })
  } catch (error) {
    void writeLog("warn", "internal router stop failed", { error: error instanceof Error ? error.message : String(error) })
  }
}
