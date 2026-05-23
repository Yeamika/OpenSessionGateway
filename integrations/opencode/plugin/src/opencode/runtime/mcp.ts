/**
 * MCP configuration — MCP config injection and surface discovery.
 *
 * Migrated from client-opencode-plugin-v2/lib/mcp.ts
 * Removed @opensessiongateway/protocol-library dependency.
 */

import { createMcpServerUrls } from "./mcp-urls.js"

type ApplyOsgMcpResult = {
  names: string[]
  metadata: LoadedMcpMetadata[]
  discovered: boolean
  changed: boolean
}

export type LoadedMcpMetadata = {
  name: string
  sourceID: string
  metadata: Record<string, unknown>
}

export type OsgMcpSurfaceDescriptor = {
  routeSegment: string
  sourceID: string
}

const MANAGED_NAMES_META_KEY = "__osgManagedMcpNames"
const MANAGED_BASE_META_KEY = "__osgManagedMcpBaseUrl"

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function trimRightSlash(value: string): string {
  return value.replace(/\/+$/, "")
}

function deriveMcpBaseUrl(input: { wsServerUrl?: string; baseUrl?: string }): string {
  const urls = createMcpServerUrls({
    baseUrl: input.baseUrl || "",
    wsServerUrl: input.wsServerUrl || "",
  })
  const sessionUrl = typeof urls.sessionBridgeUrl === "string" ? urls.sessionBridgeUrl.trim() : ""
  if (sessionUrl) {
    return trimRightSlash(sessionUrl.replace(/\/session_bridge$/i, ""))
  }
  return ""
}

function deriveSurfaceDiscoveryUrl(input: { wsServerUrl?: string; baseUrl?: string }): string {
  const direct = typeof process.env.OSG_MCP_SURFACES_URL === "string" ? process.env.OSG_MCP_SURFACES_URL.trim() : ""
  if (direct) {
    return trimRightSlash(direct).replace(/\/api\/v2\/mcpsurfaces$/i, "") + "/api/v2/mcpsurfaces"
  }

  const base = typeof input.baseUrl === "string" && input.baseUrl.trim()
    ? input.baseUrl.trim()
    : typeof input.wsServerUrl === "string"
      ? input.wsServerUrl.trim().replace(/^wss?:\/\//i, (match) => (match.toLowerCase() === "wss://" ? "https://" : "http://")).replace(/\/wsport$/i, "")
      : ""
  if (!base) return ""

  try {
    const url = new URL(base)
    url.pathname = `${trimRightSlash(url.pathname)}/mcpsurfaces`
    url.search = ""
    url.hash = ""
    return url.toString()
  } catch {
    return ""
  }
}

function descriptorFromSurfaceValue(value: unknown): OsgMcpSurfaceDescriptor | null {
  if (typeof value === "string") {
    const routeSegment = value.trim()
    return routeSegment ? { routeSegment, sourceID: routeSegment } : null
  }

  const src = record(value)
  const routeSegment = text(src.routeSegment)
  if (!routeSegment) return null
  const sourceID = text(src.sourceID) || routeSegment
  return {
    routeSegment,
    sourceID,
  }
}

function descriptorsFromPluginValue(value: unknown): OsgMcpSurfaceDescriptor[] {
  const src = record(value)
  const sourceID = text(src.sourceID)
  const rawRouteSegments = Array.isArray(src.routeSegments) ? src.routeSegments : []
  return rawRouteSegments.flatMap((item) => {
    const surface = descriptorFromSurfaceValue(item)
    if (!surface) return []
    return [{
      routeSegment: surface.routeSegment,
      sourceID: sourceID || surface.sourceID,
    }]
  })
}

function normalizeSurfaceDescriptors(values: OsgMcpSurfaceDescriptor[]): OsgMcpSurfaceDescriptor[] {
  const map = new Map<string, OsgMcpSurfaceDescriptor>()
  for (const value of values) {
    const routeSegment = text(value.routeSegment)
    if (!routeSegment) continue
    const current = map.get(routeSegment)
    const sourceID = text(value.sourceID) || text(current?.sourceID) || routeSegment
    map.set(routeSegment, {
      routeSegment,
      sourceID,
    })
  }
  return [...map.values()].sort((a, b) => a.routeSegment.localeCompare(b.routeSegment))
}

async function discoverSurfaceDescriptors(input: { wsServerUrl?: string; baseUrl?: string }): Promise<OsgMcpSurfaceDescriptor[]> {
  const url = deriveSurfaceDiscoveryUrl(input)
  if (!url) return []

  try {
    const response = await fetch(url)
    if (!response.ok) return []
    const payload = await response.json() as { surfaces?: unknown[]; plugins?: unknown[] }
    const direct = Array.isArray(payload.surfaces)
      ? payload.surfaces.flatMap((item) => {
        const descriptor = descriptorFromSurfaceValue(item)
        return descriptor ? [descriptor] : []
      })
      : []
    const fromPlugins = Array.isArray(payload.plugins)
      ? payload.plugins.flatMap((plugin) => descriptorsFromPluginValue(plugin))
      : []
    return normalizeSurfaceDescriptors([...direct, ...fromPlugins])
  } catch {
    return []
  }
}

export async function discoverOsgSurfaces(input: { wsServerUrl?: string; baseUrl?: string }): Promise<string[]> {
  return (await discoverSurfaceDescriptors(input)).map((item) => item.routeSegment)
}

function buildRemoteConfig(surface: OsgMcpSurfaceDescriptor, runtimeID: string, instanceWorkspaceDirectory: string, mcpBaseUrl: string): Record<string, unknown> {
  const routeSegment = surface.routeSegment
  return withHandshakeQuery({
    type: "remote",
    url: mcpBaseUrl ? `${mcpBaseUrl}/${routeSegment}` : "",
    oauth: false,
    timeout: 8000,
  }, { runtimeID, instanceWorkspaceDirectory }) as Record<string, unknown>
}

function withHandshakeQuery(config: unknown, input: { runtimeID?: string; instanceWorkspaceDirectory?: string }): unknown {
  if (!config || typeof config !== "object") return config
  const src = config as Record<string, unknown>
  const type = typeof src.type === "string" ? src.type.trim() : ""
  if (type !== "remote") return config

  const rawUrl = typeof src.url === "string" ? src.url.trim() : ""
  if (!rawUrl) return config
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return config
  }

  const cleanRuntimeID = typeof input.runtimeID === "string" ? input.runtimeID.trim() : ""
  if (cleanRuntimeID) {
    url.searchParams.set("runtimeID", cleanRuntimeID)
  }

  const cleanInstanceWorkspaceDirectory = typeof input.instanceWorkspaceDirectory === "string" ? input.instanceWorkspaceDirectory.trim() : ""
  if (cleanInstanceWorkspaceDirectory) {
    url.searchParams.set("instanceWorkspaceDirectory", cleanInstanceWorkspaceDirectory)
  }

  return {
    ...src,
    url: url.toString(),
  }
}

export function buildOsgMcpConfig(input: {
  routeSegments?: string[]
  surfaces?: OsgMcpSurfaceDescriptor[]
  runtimeID?: string
  instanceWorkspaceDirectory?: string
  wsServerUrl?: string
  baseUrl?: string
}): Record<string, unknown> {
  const surfaces = normalizeSurfaceDescriptors(
    Array.isArray(input.surfaces) && input.surfaces.length > 0
      ? input.surfaces
      : (Array.isArray(input.routeSegments) ? input.routeSegments : [])
        .filter((name) => typeof name === "string" && name.trim())
        .map((name) => ({ routeSegment: name.trim(), sourceID: name.trim() })),
  )
  const runtimeID = input.runtimeID || ""
  const instanceWorkspaceDirectory = input.instanceWorkspaceDirectory || ""
  const mcpBaseUrl = deriveMcpBaseUrl(input)
  return Object.fromEntries(surfaces.map((surface) => [surface.routeSegment, buildRemoteConfig(surface, runtimeID, instanceWorkspaceDirectory, mcpBaseUrl)]))
}

function normalizeMcpRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

export function readEnabledMcpNames(value: unknown): string[] {
  const mcp = normalizeMcpRecord(value)
  return Object.entries(mcp)
    .filter(([name, entry]) => {
      if (!name.trim()) return false
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false
      const src = entry as Record<string, unknown>
      return src.enabled !== false
    })
    .map(([name]) => name.trim())
    .sort((a, b) => a.localeCompare(b))
}

function readMetadataRecord(entry: Record<string, unknown>): Record<string, unknown> {
  return record(entry.metadata)
}

export function readEnabledMcpMetadata(value: unknown): LoadedMcpMetadata[] {
  const mcp = normalizeMcpRecord(value)
  return Object.entries(mcp)
    .flatMap(([name, entry]) => {
      const cleanName = text(name)
      if (!cleanName) return []
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return []
      const src = entry as Record<string, unknown>
      if (src.enabled === false) return []

      const metadata = readMetadataRecord(src)
      const sourceID = text(metadata.sourceID)
      if (!sourceID) return []

      return [{
        name: cleanName,
        sourceID,
        metadata,
      }]
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

function enabledSurfaceMetadata(surfaces: OsgMcpSurfaceDescriptor[], enabledNames: string[]): LoadedMcpMetadata[] {
  const enabled = new Set(enabledNames.map((item) => item.trim()).filter(Boolean))
  return surfaces
    .filter((surface) => enabled.has(surface.routeSegment) && text(surface.sourceID))
    .map((surface) => ({
      name: surface.routeSegment,
      sourceID: surface.sourceID,
      metadata: { sourceID: surface.sourceID },
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.sourceID.localeCompare(b.sourceID))
}

function readManagedNamesMeta(cfg: Record<string, unknown>): string[] {
  const value = cfg[MANAGED_NAMES_META_KEY]
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()))].sort((a, b) => a.localeCompare(b))
}

function writeManagedNamesMeta(cfg: Record<string, unknown>, names: string[]) {
  Object.defineProperty(cfg, MANAGED_NAMES_META_KEY, {
    value: [...names],
    enumerable: false,
    configurable: true,
    writable: true,
  })
}

function readManagedBaseMeta(cfg: Record<string, unknown>): string {
  const value = cfg[MANAGED_BASE_META_KEY]
  return typeof value === "string" ? value.trim() : ""
}

function writeManagedBaseMeta(cfg: Record<string, unknown>, baseUrl: string) {
  Object.defineProperty(cfg, MANAGED_BASE_META_KEY, {
    value: baseUrl,
    enumerable: false,
    configurable: true,
    writable: true,
  })
}

function remoteBaseUrl(config: unknown): string {
  const src = config && typeof config === "object" ? config as Record<string, unknown> : {}
  if (typeof src.type !== "string" || src.type.trim() !== "remote") return ""
  const rawUrl = typeof src.url === "string" ? src.url.trim() : ""
  if (!rawUrl) return ""
  try {
    const url = new URL(rawUrl)
    return `${url.origin}${url.pathname}`.replace(/\/+$/g, "")
  } catch {
    return ""
  }
}

function managedBaseCandidates(currentBase: string, previousBase: string): string[] {
  return [...new Set([currentBase, previousBase].filter((item) => typeof item === "string" && item.trim().length > 0).map((item) => item.replace(/\/+$/g, "")))]
}

function isManagedEntry(name: string, config: unknown, managedNames: string[], managedBases: string[]): boolean {
  if (managedNames.includes(name)) return true
  const base = remoteBaseUrl(config)
  return Boolean(base && managedBases.some((item) => base.startsWith(item)))
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`
  if (!value || typeof value !== "object") return JSON.stringify(value)
  const src = value as Record<string, unknown>
  return `{${Object.keys(src).sort((a, b) => a.localeCompare(b)).map((key) => `${JSON.stringify(key)}:${stableStringify(src[key])}`).join(",")}}`
}

function explicitEnabledEntry(config: unknown): Record<string, unknown> | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null
  const src = config as Record<string, unknown>
  return src.enabled === true ? src : null
}

function mergeManagedConfig(generated: unknown, existing: unknown): Record<string, unknown> {
  const base = generated && typeof generated === "object" ? generated as Record<string, unknown> : {}
  const explicit = explicitEnabledEntry(existing)
  if (!explicit) return { ...base, enabled: true }
  const { type: _type, url: _url, metadata: _metadata, ...rest } = explicit
  return {
    ...base,
    ...rest,
    enabled: true,
  }
}

export async function applyOsgMcpConfig(
  cfg: Record<string, unknown>,
  writeLog: (level: string, message: string, extra?: Record<string, unknown>) => Promise<void>,
  getRuntimeID?: () => string,
  getInstanceWorkspaceDirectory?: () => string,
  getWsServerUrl?: () => string,
): Promise<ApplyOsgMcpResult> {
  const wsServerUrl = typeof getWsServerUrl === "function" ? getWsServerUrl() : ""
  const runtimeID = typeof getRuntimeID === "function" ? getRuntimeID() : ""
  const instanceWorkspaceDirectory = typeof getInstanceWorkspaceDirectory === "function" ? getInstanceWorkspaceDirectory() : ""
  const surfaces = await discoverSurfaceDescriptors({ wsServerUrl })
  const routeSegments = surfaces.map((item) => item.routeSegment)
  const mcpBaseUrl = deriveMcpBaseUrl({ wsServerUrl })
  const generatedMcp = buildOsgMcpConfig({
    surfaces,
    runtimeID,
    instanceWorkspaceDirectory,
    wsServerUrl,
  })
  const previous = normalizeMcpRecord(cfg.mcp)
  const previousManagedNames = readManagedNamesMeta(cfg)
  const managedBases = managedBaseCandidates(mcpBaseUrl, readManagedBaseMeta(cfg))
  const unmanaged = Object.fromEntries(Object.entries(previous).filter(([name, value]) => !isManagedEntry(name, value, previousManagedNames, managedBases)))
  const enabledNames = routeSegments
    .filter((name) => explicitEnabledEntry(unmanaged[name]))
    .sort((a, b) => a.localeCompare(b))
  const managed = Object.fromEntries(enabledNames.map((name) => [name, mergeManagedConfig(generatedMcp[name], unmanaged[name])]))
  const nextManagedNames = [...enabledNames]
  const next = {
    ...unmanaged,
    ...managed,
  }
  const changed = stableStringify(previous) !== stableStringify(next)
  cfg.mcp = next
  writeManagedNamesMeta(cfg, nextManagedNames)
  writeManagedBaseMeta(cfg, mcpBaseUrl)
  if (changed) {
    await writeLog("info", "mcp config injected", {
      names: enabledNames,
      discovered: routeSegments.length > 0,
      instanceWorkspaceDirectory: instanceWorkspaceDirectory || undefined,
    })
  }
  return {
    names: enabledNames,
    metadata: enabledSurfaceMetadata(surfaces, enabledNames),
    discovered: routeSegments.length > 0,
    changed,
  }
}
