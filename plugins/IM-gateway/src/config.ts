import path from "node:path";
import { fileURLToPath } from "node:url";

function defaultStateFile(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "agents",
    "serverplug-im",
    ".runtime",
    "bridge-state",
    "im-gateway.json",
  );
}

function optional(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function optionalBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return fallback;
}

function normalizePathSegment(value: string, fallback: string): string {
  const clean = value.trim().replace(/^\/+|\/+$/g, "");
  return clean || fallback;
}

export function loadConfig() {
  const routePrefix = normalizePathSegment(optional("IM_GATEWAY_ROUTE_PREFIX", "imgw"), "imgw");
  const stateFilePath = optional("IM_GATEWAY_STATE_FILE", defaultStateFile());
  const runtimeDir = path.dirname(stateFilePath);
  return {
    host: optional("IM_GATEWAY_HOST", "127.0.0.1"),
    port: optionalInt("IM_GATEWAY_PORT", 4092),
    routePrefix,
    logLevel: optional("IM_GATEWAY_LOG_LEVEL", "info"),
    pollEnabled: optionalBool("IM_GATEWAY_POLL_ENABLED", true),
    pollIntervalMs: optionalInt("IM_GATEWAY_POLL_INTERVAL_MS", 5000),
    chatPageSize: optionalInt("IM_GATEWAY_CHAT_PAGE_SIZE", 50),
    messagePageSize: optionalInt("IM_GATEWAY_MESSAGE_PAGE_SIZE", 20),
    recentEventLimit: optionalInt("IM_GATEWAY_RECENT_EVENT_LIMIT", 100),
    messageCacheLimit: optionalInt("IM_GATEWAY_MESSAGE_CACHE_LIMIT", 50),
    uploadCacheLimit: optionalInt("IM_GATEWAY_UPLOAD_CACHE_LIMIT", 200),
    assetCacheLimit: optionalInt("IM_GATEWAY_ASSET_CACHE_LIMIT", 500),
    forwardedInboundCacheLimit: optionalInt("IM_GATEWAY_FORWARDED_EVENT_CACHE_LIMIT", 1000),
    stateFilePath,
    uploadDir: optional("IM_GATEWAY_UPLOAD_DIR", path.join(runtimeDir, "uploads")),
  };
}

export type ImBridgeConfig = ReturnType<typeof loadConfig>;
