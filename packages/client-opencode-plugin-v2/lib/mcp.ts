import { createMcpServerUrls } from "./mcp-urls.js";

type ApplyOsgMcpResult = {
  names: string[];
  discovered: boolean;
  changed: boolean;
};

const MANAGED_NAMES_META_KEY = "__osgManagedMcpNames";
const MANAGED_BASE_META_KEY = "__osgManagedMcpBaseUrl";

function trimRightSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function deriveMcpBaseUrl(input: { wsServerUrl?: string; baseUrl?: string }): string {
  const urls = createMcpServerUrls({
    baseUrl: input.baseUrl || "",
    wsServerUrl: input.wsServerUrl || "",
  });
  const sessionUrl = typeof urls.sessionBridgeUrl === "string" ? urls.sessionBridgeUrl.trim() : "";
  if (sessionUrl) {
    return trimRightSlash(sessionUrl.replace(/\/session_bridge$/i, ""));
  }
  return "";
}

function deriveSurfaceDiscoveryUrl(input: { wsServerUrl?: string; baseUrl?: string }): string {
  const direct = typeof process.env.OSG_MCP_SURFACES_URL === "string" ? process.env.OSG_MCP_SURFACES_URL.trim() : "";
  if (direct) {
    return trimRightSlash(direct).replace(/\/api\/v2\/mcpsurfaces$/i, "") + "/api/v2/mcpsurfaces";
  }

  const base = typeof input.baseUrl === "string" && input.baseUrl.trim()
    ? input.baseUrl.trim()
    : typeof input.wsServerUrl === "string"
      ? input.wsServerUrl.trim().replace(/^wss?:\/\//i, (match) => (match.toLowerCase() === "wss://" ? "https://" : "http://")).replace(/\/wsport$/i, "")
      : "";
  if (!base) return "";

  try {
    const url = new URL(base);
    url.pathname = `${trimRightSlash(url.pathname)}/mcpsurfaces`;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

async function discoverRouteSegments(input: { wsServerUrl?: string; baseUrl?: string }): Promise<string[]> {
  const url = deriveSurfaceDiscoveryUrl(input);
  if (!url) return [];

  try {
    const response = await fetch(url);
    if (!response.ok) return [];
    const payload = await response.json() as { surfaces?: unknown[]; plugins?: Array<{ routeSegments?: unknown[] }> };
    const all = Array.isArray(payload.surfaces)
      ? payload.surfaces
      : Array.isArray(payload.plugins)
        ? payload.plugins.flatMap((plugin) => Array.isArray(plugin.routeSegments) ? plugin.routeSegments : [])
        : [];
    return [...new Set(all.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()))]
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function buildRemoteConfig(routeSegment: string, runtimeID: string, instanceWorkspaceDirectory: string, mcpBaseUrl: string): Record<string, unknown> {
  return withHandshakeQuery({
    type: "remote",
    url: mcpBaseUrl ? `${mcpBaseUrl}/${routeSegment}` : "",
    oauth: false,
    timeout: 8000,
  }, { runtimeID, instanceWorkspaceDirectory }) as Record<string, unknown>;
}

function withHandshakeQuery(config: unknown, input: { runtimeID?: string; instanceWorkspaceDirectory?: string }): unknown {
  if (!config || typeof config !== "object") return config;
  const src = config as Record<string, unknown>;
  const type = typeof src.type === "string" ? src.type.trim() : "";
  if (type !== "remote") return config;

  const rawUrl = typeof src.url === "string" ? src.url.trim() : "";
  if (!rawUrl) return config;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return config;
  }

  const cleanRuntimeID = typeof input.runtimeID === "string" ? input.runtimeID.trim() : "";
  if (cleanRuntimeID) {
    url.searchParams.set("runtimeID", cleanRuntimeID);
  }

  const cleanInstanceWorkspaceDirectory = typeof input.instanceWorkspaceDirectory === "string" ? input.instanceWorkspaceDirectory.trim() : "";
  if (cleanInstanceWorkspaceDirectory) {
    url.searchParams.set("instanceWorkspaceDirectory", cleanInstanceWorkspaceDirectory);
  }

  return {
    ...src,
    url: url.toString(),
  };
}

export function buildOsgMcpConfig(input: {
  routeSegments?: string[];
  runtimeID?: string;
  instanceWorkspaceDirectory?: string;
  wsServerUrl?: string;
  baseUrl?: string;
}): Record<string, unknown> {
  const names = (Array.isArray(input.routeSegments) ? input.routeSegments : [])
    .filter((name) => typeof name === "string" && name.trim())
    .map((name) => name.trim());
  const runtimeID = input.runtimeID || "";
  const instanceWorkspaceDirectory = input.instanceWorkspaceDirectory || "";
  const mcpBaseUrl = deriveMcpBaseUrl(input);
  return Object.fromEntries(names.map((name) => [name, buildRemoteConfig(name, runtimeID, instanceWorkspaceDirectory, mcpBaseUrl)]));
}

function normalizeMcpRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function readManagedNamesMeta(cfg: Record<string, unknown>): string[] {
  const value = cfg[MANAGED_NAMES_META_KEY];
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()))].sort((a, b) => a.localeCompare(b));
}

function writeManagedNamesMeta(cfg: Record<string, unknown>, names: string[]) {
  Object.defineProperty(cfg, MANAGED_NAMES_META_KEY, {
    value: [...names],
    enumerable: false,
    configurable: true,
    writable: true,
  });
}

function readManagedBaseMeta(cfg: Record<string, unknown>): string {
  const value = cfg[MANAGED_BASE_META_KEY];
  return typeof value === "string" ? value.trim() : "";
}

function writeManagedBaseMeta(cfg: Record<string, unknown>, baseUrl: string) {
  Object.defineProperty(cfg, MANAGED_BASE_META_KEY, {
    value: baseUrl,
    enumerable: false,
    configurable: true,
    writable: true,
  });
}

function remoteBaseUrl(config: unknown): string {
  const src = config && typeof config === "object" ? config as Record<string, unknown> : {};
  if (typeof src.type !== "string" || src.type.trim() !== "remote") return "";
  const rawUrl = typeof src.url === "string" ? src.url.trim() : "";
  if (!rawUrl) return "";
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}`.replace(/\/+$/g, "");
  } catch {
    return "";
  }
}

function managedBaseCandidates(currentBase: string, previousBase: string): string[] {
  return [...new Set([currentBase, previousBase].filter((item) => typeof item === "string" && item.trim().length > 0).map((item) => item.replace(/\/+$/g, "")))];
}

function isManagedEntry(name: string, config: unknown, managedNames: string[], managedBases: string[]): boolean {
  if (managedNames.includes(name)) return true;
  const base = remoteBaseUrl(config);
  return Boolean(base && managedBases.some((item) => base.startsWith(item)));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  const src = value as Record<string, unknown>;
  return `{${Object.keys(src).sort((a, b) => a.localeCompare(b)).map((key) => `${JSON.stringify(key)}:${stableStringify(src[key])}`).join(",")}}`;
}

function explicitEnabledEntry(config: unknown): Record<string, unknown> | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const src = config as Record<string, unknown>;
  return src.enabled === true ? src : null;
}

function mergeManagedConfig(generated: unknown, existing: unknown): Record<string, unknown> {
  const base = generated && typeof generated === "object" ? generated as Record<string, unknown> : {};
  const explicit = explicitEnabledEntry(existing);
  if (!explicit) return { ...base, enabled: true };
  const { type: _type, url: _url, ...rest } = explicit;
  return {
    ...base,
    ...rest,
    enabled: true,
  };
}

export async function applyOsgMcpConfig(
  cfg: Record<string, unknown>,
  writeLog: (level: string, message: string, extra?: Record<string, unknown>) => Promise<void>,
  getRuntimeID?: () => string,
  getInstanceWorkspaceDirectory?: () => string,
  getWsServerUrl?: () => string,
): Promise<ApplyOsgMcpResult> {
  const wsServerUrl = typeof getWsServerUrl === "function" ? getWsServerUrl() : "";
  const runtimeID = typeof getRuntimeID === "function" ? getRuntimeID() : "";
  const instanceWorkspaceDirectory = typeof getInstanceWorkspaceDirectory === "function" ? getInstanceWorkspaceDirectory() : "";
  const routeSegments = await discoverRouteSegments({ wsServerUrl });
  const mcpBaseUrl = deriveMcpBaseUrl({ wsServerUrl });
  const generatedMcp = buildOsgMcpConfig({
    routeSegments,
    runtimeID,
    instanceWorkspaceDirectory,
    wsServerUrl,
  });
  const previous = normalizeMcpRecord(cfg.mcp);
  const previousManagedNames = readManagedNamesMeta(cfg);
  const managedBases = managedBaseCandidates(mcpBaseUrl, readManagedBaseMeta(cfg));
  const unmanaged = Object.fromEntries(Object.entries(previous).filter(([name, value]) => !isManagedEntry(name, value, previousManagedNames, managedBases)));
  const enabledNames = routeSegments
    .filter((name) => explicitEnabledEntry(unmanaged[name]))
    .sort((a, b) => a.localeCompare(b));
  const managed = Object.fromEntries(enabledNames.map((name) => [name, mergeManagedConfig(generatedMcp[name], unmanaged[name])]));
  const nextManagedNames = [...enabledNames];
  const next = {
    ...unmanaged,
    ...managed,
  };
  const changed = stableStringify(previous) !== stableStringify(next);
  cfg.mcp = next;
  writeManagedNamesMeta(cfg, nextManagedNames);
  writeManagedBaseMeta(cfg, mcpBaseUrl);
  if (changed) {
    await writeLog("info", "mcp config injected", {
      names: enabledNames,
      discovered: routeSegments.length > 0,
      instanceWorkspaceDirectory: instanceWorkspaceDirectory || undefined,
    });
  }
  return {
    names: enabledNames,
    discovered: routeSegments.length > 0,
    changed,
  };
}
