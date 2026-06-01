/**
 * Configuration — runtime config management.
 *
 * Migrated from client-opencode-plugin-v2/lib/config.ts
 * Simplified for GlassVein (no OSGClient dependency).
 */

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export type VeinRuntimeConfig = {
  routerUrl: string
  runtimeID: string
  hostName: string
  logDir: string
  internalRouter: InternalRouterRuntimeConfig
}

function bool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value
  const raw = text(value).toLowerCase()
  if (!raw) return null
  if (["1", "true", "yes", "on", "enabled"].includes(raw)) return true
  if (["0", "false", "no", "off", "disabled"].includes(raw)) return false
  return null
}

function positiveInt(value: unknown): number | null {
  const raw = typeof value === "number" ? value : Number(text(value))
  if (!Number.isInteger(raw) || raw <= 0) return null
  return raw
}

function splitCsv(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => splitCsv(item))
  return text(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function connectHostFor(bindHost: string): string {
  if (bindHost === "0.0.0.0" || bindHost === "::") return "127.0.0.1"
  return bindHost
}

function wsUrlFromHostPort(host: string, port: number): string {
  const cleanHost = connectHostFor(host)
  const printableHost = cleanHost.includes(":") && !cleanHost.startsWith("[") ? `[${cleanHost}]` : cleanHost
  return `ws://${printableHost}:${port}`
}

function parseBindAddr(bindAddr: string): { host: string; port: number } | null {
  const clean = text(bindAddr)
  if (!clean) return null
  const index = clean.lastIndexOf(":")
  if (index <= 0) return null
  const host = clean.slice(0, index).replace(/^\[(.*)\]$/, "$1")
  const port = positiveInt(clean.slice(index + 1))
  if (!host || !port) return null
  return { host, port }
}

export type VeinRuntimeConfigPatch = {
  routerUrl?: string
  runtimeID?: string
  internalRouter?: Partial<InternalRouterRuntimeConfig>
}

export type InternalRouterRuntimeConfig = {
  enabled: boolean
  nodeId: string
  bindHost: string
  port: number
  bindAddr: string
  routerUrl: string
  upstreamUrls: string[]
  binaryPath: string
  startupTimeoutMs: number
}

const DEFAULT_LOG_DIR = path.resolve(
  os.homedir(),
  ".config",
  "opencode-vein-plugin",
  "logs",
)

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeWsUrl(value: unknown): string {
  const next = text(value)
  if (!next) return ""
  try {
    const url = new URL(next)
    if (url.protocol !== "ws:" && url.protocol !== "wss:") return ""
    return url.toString()
  } catch {
    return ""
  }
}

async function readJson(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const next = await fs.readFile(filePath, "utf8")
    return JSON.parse(next) as Record<string, unknown>
  } catch {
    return null
  }
}

function resolveHomeConfigPath(): string {
  return path.join(os.homedir(), ".config", "opencode-vein-plugin-config.json")
}

export function resolveVeinConfigPath(): string {
  return resolveHomeConfigPath()
}

export async function readVeinConfig(): Promise<Record<string, unknown> | null> {
  return readJson(resolveHomeConfigPath())
}

export function readVeinEnvOverrides(): {
  routerUrl: string
  runtimeID: string
  logDir: string
} {
  return {
    routerUrl: normalizeWsUrl(process.env.VEIN_ROUTER_URL || process.env.GV_ROUTER_URL || process.env.OSG_WS_URL),
    runtimeID: text(process.env.VEIN_RUNTIME_ID || process.env.GV_RUNTIME_ID || process.env.OSG_RUNTIME_ID),
    logDir: text(process.env.VEIN_LOG_DIR || process.env.GV_LOG_DIR || process.env.OSG_LOG_DIR),
  }
}

export function readInternalRouterEnvOverrides(): Partial<InternalRouterRuntimeConfig> & { enabled?: boolean } {
  const bindAddr = text(process.env.VEIN_ROUTER_BIND_ADDR || process.env.GV_ROUTER_BIND_ADDR || process.env.OSG_ROUTER_BIND_ADDR)
  const parsed = parseBindAddr(bindAddr)
  const port = positiveInt(process.env.VEIN_ROUTER_PORT || process.env.GV_ROUTER_PORT || process.env.OSG_ROUTER_PORT)
  const enabled = bool(process.env.VEIN_INTERNAL_ROUTER || process.env.GV_INTERNAL_ROUTER || process.env.OSG_INTERNAL_ROUTER)
  return {
    ...(enabled !== null ? { enabled } : {}),
    ...(text(process.env.VEIN_ROUTER_NODE_ID || process.env.GV_ROUTER_NODE_ID || process.env.OSG_ROUTER_NODE_ID) ? { nodeId: text(process.env.VEIN_ROUTER_NODE_ID || process.env.GV_ROUTER_NODE_ID || process.env.OSG_ROUTER_NODE_ID) } : {}),
    ...(parsed ? { bindHost: parsed.host, port: parsed.port, bindAddr } : {}),
    ...(text(process.env.VEIN_ROUTER_BIND_HOST || process.env.GV_ROUTER_BIND_HOST || process.env.OSG_ROUTER_BIND_HOST) ? { bindHost: text(process.env.VEIN_ROUTER_BIND_HOST || process.env.GV_ROUTER_BIND_HOST || process.env.OSG_ROUTER_BIND_HOST) } : {}),
    ...(port ? { port } : {}),
    ...(splitCsv(process.env.VEIN_UPSTREAM_ROUTER_URLS || process.env.GV_UPSTREAM_ROUTER_URLS || process.env.OSG_UPSTREAM_ROUTER_URLS).length > 0 ? { upstreamUrls: splitCsv(process.env.VEIN_UPSTREAM_ROUTER_URLS || process.env.GV_UPSTREAM_ROUTER_URLS || process.env.OSG_UPSTREAM_ROUTER_URLS) } : {}),
    ...(normalizeWsUrl(process.env.VEIN_UPSTREAM_ROUTER_URL || process.env.GV_UPSTREAM_ROUTER_URL || process.env.OSG_UPSTREAM_ROUTER_URL) ? { upstreamUrls: [normalizeWsUrl(process.env.VEIN_UPSTREAM_ROUTER_URL || process.env.GV_UPSTREAM_ROUTER_URL || process.env.OSG_UPSTREAM_ROUTER_URL)] } : {}),
    ...(text(process.env.VEIN_ROUTER_BINARY || process.env.GV_ROUTER_BINARY || process.env.GLASSVEIN_ROUTER_BINARY) ? { binaryPath: text(process.env.VEIN_ROUTER_BINARY || process.env.GV_ROUTER_BINARY || process.env.GLASSVEIN_ROUTER_BINARY) } : {}),
    ...(positiveInt(process.env.VEIN_ROUTER_STARTUP_TIMEOUT_MS || process.env.GV_ROUTER_STARTUP_TIMEOUT_MS || process.env.OSG_ROUTER_STARTUP_TIMEOUT_MS) ? { startupTimeoutMs: positiveInt(process.env.VEIN_ROUTER_STARTUP_TIMEOUT_MS || process.env.GV_ROUTER_STARTUP_TIMEOUT_MS || process.env.OSG_ROUTER_STARTUP_TIMEOUT_MS) as number } : {}),
  }
}

export async function writeVeinConfig(input: VeinRuntimeConfigPatch): Promise<Record<string, unknown>> {
  const filePath = resolveVeinConfigPath()
  const current = (await readJson(filePath)) || {}
  const next = { ...current }
  const routerUrl = normalizeWsUrl(input.routerUrl)
  const runtimeID = text(input.runtimeID)
  if (routerUrl) {
    next.routerUrl = routerUrl
  }
  if (runtimeID) {
    next.runtimeID = runtimeID
  }
  if (input.internalRouter && typeof input.internalRouter === "object") {
    next.internalRouter = {
      ...record(current.internalRouter),
      ...input.internalRouter,
    }
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(next, null, 2), "utf8")
  return next
}

export async function buildVeinRuntimeConfig(): Promise<VeinRuntimeConfig> {
  const sanitizeRuntimePart = (value: unknown, fallback: string): string => {
    const text = typeof value === "string" ? value.trim().toLowerCase() : ""
    const normalized = text
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/_+/g, "_")
    return normalized || fallback
  }

  const resolvePlatformName = () => {
    if (process.platform === "win32") return "windows"
    if (process.platform === "linux") return "linux"
    return process.platform
  }

  const envOverride = readVeinEnvOverrides()

  const resolveRuntimeID = () => {
    const explicit = envOverride.runtimeID
    if (explicit) return explicit

    const fromConfig = text(config?.runtimeID)
    if (fromConfig) return fromConfig

    const host = sanitizeRuntimePart(os.hostname(), "host")
    const user = sanitizeRuntimePart(os.userInfo().username, "user")
    return `vein_${resolvePlatformName()}_${host}_${user}`
  }

  const resolveHostName = () => {
    const user = os.userInfo().username || "unknown"
    const host = os.hostname() || "unknown"
    return `opencode-${user}@${host}`
  }

  const config = await readVeinConfig()
  const internalConfig = record(config?.internalRouter)
  const internalEnv = readInternalRouterEnvOverrides()

  const explicitRouterUrl = envOverride.routerUrl || normalizeWsUrl(config?.routerUrl)

  const resolveInternalRouter = (): InternalRouterRuntimeConfig => {
    const cfgEnabled = bool(internalConfig.enabled)
    const enabled = internalEnv.enabled ?? cfgEnabled ?? !explicitRouterUrl
    const nodeId = text(internalEnv.nodeId) || text(internalConfig.nodeId) || "opencode-gv-router"
    const bindAddrFromConfig = text(internalEnv.bindAddr) || text(internalConfig.bindAddr)
    const parsed = parseBindAddr(bindAddrFromConfig)
    const bindHost = text(internalEnv.bindHost) || text(internalConfig.bindHost) || parsed?.host || "127.0.0.1"
    const port = positiveInt(internalEnv.port) || positiveInt(internalConfig.port) || parsed?.port || 7240
    const bindAddr = bindAddrFromConfig || `${bindHost}:${port}`
    const upstreamUrls = (internalEnv.upstreamUrls && internalEnv.upstreamUrls.length > 0)
      ? internalEnv.upstreamUrls
      : splitCsv(internalConfig.upstreamUrls || internalConfig.upstreamUrl).map(normalizeWsUrl).filter(Boolean)
    return {
      enabled,
      nodeId,
      bindHost,
      port,
      bindAddr,
      routerUrl: wsUrlFromHostPort(bindHost, port),
      upstreamUrls,
      binaryPath: text(internalEnv.binaryPath) || text(internalConfig.binaryPath),
      startupTimeoutMs: positiveInt(internalEnv.startupTimeoutMs) || positiveInt(internalConfig.startupTimeoutMs) || 5_000,
    }
  }

  const internalRouter = resolveInternalRouter()

  const resolveRouterUrl = async () => explicitRouterUrl || internalRouter.routerUrl

  const resolveLogDir = () => {
    const fromEnv = envOverride.logDir
    if (fromEnv) return fromEnv

    const fromConfig = typeof config?.logDir === "string" ? (config.logDir as string).trim() : ""
    if (fromConfig) return fromConfig
    return DEFAULT_LOG_DIR
  }

  return {
    routerUrl: await resolveRouterUrl(),
    runtimeID: resolveRuntimeID(),
    hostName: resolveHostName(),
    logDir: resolveLogDir(),
    internalRouter,
  }
}
