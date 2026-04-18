import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type OsgRuntimeConfig = {
  wsServerUrl: string;
  runtimeID: string;
  hostName: string;
  logDir: string;
};

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_OSG_LOG_DIR = path.resolve(
  packageRoot,
  "..",
  "..",
  "agents",
  "opencode-plug",
  ".runtime",
  "opensessiongateway",
);

export async function buildOsgRuntimeConfig(ctx: any): Promise<OsgRuntimeConfig> {
  const sanitizeRuntimePart = (value: unknown, fallback: string): string => {
    const text = typeof value === "string" ? value.trim().toLowerCase() : "";
    const normalized = text
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/_+/g, "_");
    return normalized || fallback;
  };

  const resolvePlatformName = () => {
    if (process.platform === "win32") return "windows";
    if (process.platform === "linux") return "linux";
    return process.platform;
  };

  const resolveRuntimeID = () => {
    const explicit = typeof process.env.OSG_RUNTIME_ID === "string" ? process.env.OSG_RUNTIME_ID.trim() : "";
    if (explicit) return explicit;

    const host = sanitizeRuntimePart(os.hostname(), "host");
    const user = sanitizeRuntimePart(os.userInfo().username, "user");
    return `run_plugin_${resolvePlatformName()}_${host}_${user}`;
  };

  const resolveHostName = () => {
    const user = os.userInfo().username || "unknown";
    const host = os.hostname() || "unknown";
    return `opencode-${user}@${host}`;
  };

  const normalizeWsUrl = (value: unknown): string => {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) return "";
    try {
      const url = new URL(text);
      if (url.protocol !== "ws:" && url.protocol !== "wss:") return "";
      return url.toString();
    } catch {
      return "";
    }
  };

  const wsUrlFromBase = (value: unknown): string => {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) return "";
    const base = text.replace(/\/+$/, "");
    const wsBase = base.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:");
    return `${wsBase}/wsport`;
  };

  const readJson = async (filePath: string): Promise<Record<string, unknown> | null> => {
    try {
      const text = await fs.readFile(filePath, "utf8");
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  const readOpenSessionGatewayConfig = async (): Promise<Record<string, unknown> | null> => {
    const localConfigPath = path.resolve(process.cwd(), "./.config/opensessiongateway-config.json");
    const localConfig = await readJson(localConfigPath);
    if (localConfig) return localConfig;

    const homeConfigPath = path.join(os.homedir(), ".config", "opensessiongateway-config.json");
    const homeConfig = await readJson(homeConfigPath);
    if (homeConfig) return homeConfig;

    return null;
  };

  const config = await readOpenSessionGatewayConfig();

  const resolveWsServerUrl = async () => {
    const baseEnvUrl = wsUrlFromBase(process.env.OSG_BASE_URL);
    if (baseEnvUrl) return baseEnvUrl;

    const baseConfigUrl = wsUrlFromBase(config?.baseUrl);
    if (baseConfigUrl) return baseConfigUrl;

    const envUrl = normalizeWsUrl(process.env.OSG_WS_URL);
    if (envUrl) return envUrl;

    const configUrl = normalizeWsUrl(config?.wsUrl);
    if (configUrl) return configUrl;

    return "ws://127.0.0.1:4088/api/v2/wsport";
  };

  const resolveLogDir = () => {
    const fromEnv = typeof process.env.OSG_LOG_DIR === "string" ? process.env.OSG_LOG_DIR.trim() : "";
    if (fromEnv) return fromEnv;

    const fromConfig = typeof config?.logDir === "string" ? (config.logDir as string).trim() : "";
    if (fromConfig) return fromConfig;
    return DEFAULT_OSG_LOG_DIR;
  };

  return {
    wsServerUrl: await resolveWsServerUrl(),
    runtimeID: resolveRuntimeID(),
    hostName: resolveHostName(),
    logDir: resolveLogDir(),
  };
}
