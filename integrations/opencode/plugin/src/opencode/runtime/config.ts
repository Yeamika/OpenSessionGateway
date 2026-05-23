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
}

export type VeinRuntimeConfigPatch = {
  routerUrl?: string
  runtimeID?: string
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
    routerUrl: normalizeWsUrl(process.env.VEIN_ROUTER_URL),
    runtimeID: text(process.env.VEIN_RUNTIME_ID),
    logDir: text(process.env.VEIN_LOG_DIR),
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

  const resolveRouterUrl = async () => {
    if (envOverride.routerUrl) return envOverride.routerUrl

    const configUrl = normalizeWsUrl(config?.routerUrl)
    if (configUrl) return configUrl

    return "ws://127.0.0.1:7240"
  }

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
  }
}
