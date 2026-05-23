import { randomUUID } from "node:crypto";
import http from "node:http";
import { pipeline } from "node:stream/promises";

import type { PluginContext } from "@opensessiongateway/server-plugin-sdk";

import type { ImBridgeConfig } from "./config.js";
import type {
  GatewayAccount,
  GatewayAsset,
  GatewayInboundEvent,
  GatewayMemberIDType,
  GatewayMessageSummary,
  GatewayResourceType,
  GatewayRoute,
  GatewayRouteStatus,
  GatewaySendMessageResult,
  GatewaySessionBinding,
  GatewayUpload,
  GatewayUserIDType,
} from "./types.js";
import { accountKeyOf, routeIDOf } from "./types.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type SessionStatusChangeEvent = {
  kind: "snapshot" | "change" | "resync" | "disconnect";
  source: "snapshot" | "client_content" | "runtime_connect" | "runtime_disconnect";
  current: {
    runtimeID: string;
    sessionID: string;
    runtimeStatus: "online" | "offline" | "stale" | string;
    sessionState: "idle" | "busy" | "waiting" | "stopped" | null;
    sessionReason: "completed" | "pending" | "tool" | "generating" | "reasoning" | "compacting" | "permission" | "question" | "aborted" | "error" | null;
    sessionMeta: Record<string, unknown> | null;
    title: string | null;
    displayID: string | null;
    instanceWorkspaceDirectory: string | null;
    runtimeHost: string | null;
    lastActiveTime: string | null;
    updatedAt: string;
  };
};

export type SessionStatusChangeHook = {
  (target: { runtimeID: string; sessionID: string }, listener: (event: SessionStatusChangeEvent) => void | Promise<void>): () => void;
  (
    target: { runtimeID: string; sessionID: string },
    options: { emitCurrent?: boolean },
    listener: (event: SessionStatusChangeEvent) => void | Promise<void>,
  ): () => void;
};

export type AccountRuntimeEntry = {
  account: GatewayAccount;
  provider: import("./provider.js").GatewayProviderPlugin;
  runtime: import("./provider.js").GatewayProviderAccountRuntime;
  webhookPath: string;
  webhookHandler: ((req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>) | null;
};

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export const STATUS_BUSY_REACTION_EMOJI = "Typing";

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    status: number,
    code: string,
    message: string,
  ) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function createLogger(level: string, ctx: PluginContext) {
  const threshold = LEVEL_WEIGHT[(level as LogLevel) || "info"] || LEVEL_WEIGHT.info;
  function write(target: LogLevel, message: string, extra?: Record<string, unknown>) {
    if (LEVEL_WEIGHT[target] < threshold) return;
    ctx.log(target === "debug" ? "info" : target, message, extra);
  }
  return {
    debug(message: string, extra?: Record<string, unknown>) { write("debug", message, extra); },
    info(message: string, extra?: Record<string, unknown>) { write("info", message, extra); },
    warn(message: string, extra?: Record<string, unknown>) { write("warn", message, extra); },
    error(message: string, extra?: Record<string, unknown>) { write("error", message, extra); },
  };
}

export function readSessionStatusHook(ctx: PluginContext): SessionStatusChangeHook | null {
  const hooks = ctx.hooks as typeof ctx.hooks & { onSessionStatusChange?: SessionStatusChangeHook };
  return typeof hooks.onSessionStatusChange === "function" ? hooks.onSessionStatusChange : null;
}

export function toStatusLabel(input: { runtimeStatus?: string | null; sessionState?: string | null }): "idle" | "busy" | "error" | "offline" | null {
  const runtimeStatus = (input.runtimeStatus || "").trim().toLowerCase();
  if (runtimeStatus === "offline") return "offline";
  const sessionState = (input.sessionState || "").trim().toLowerCase();
  if (sessionState === "idle") return "idle";
  if (sessionState === "busy") return "busy";
  if (sessionState === "waiting" || sessionState === "stopped") return "error";
  return null;
}

export function json(res: http.ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

export function publicHost(host: string): string {
  const clean = host.trim();
  if (!clean || clean === "0.0.0.0" || clean === "::") return "127.0.0.1";
  return clean;
}

export function normalizePath(value: string): string {
  const clean = value.trim();
  return clean.startsWith("/") ? clean : `/${clean}`;
}

export function queryLimit(url: URL, key: string, fallback: number, max = 50): number {
  const raw = url.searchParams.get(key)?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.max(1, Math.floor(parsed)));
}

export function requireString(value: unknown, name: string): string {
  const clean = typeof value === "string" ? value.trim() : "";
  if (!clean) throw new Error(`${name} is required`);
  return clean;
}

export function requireType(value: unknown, name: string): GatewayResourceType | "image" | "file" {
  const clean = requireString(value, name);
  if (clean === "image" || clean === "file" || clean === "audio" || clean === "media") return clean;
  throw new Error(`${name} must be one of image/file/audio/media`);
}

export function splitPathname(pathname: string): string[] {
  return pathname.split("/").filter(Boolean).map((item) => decodeURIComponent(item));
}

export async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  if (!raw.length) return {};
  try {
    const parsed = JSON.parse(raw.toString("utf8"));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    throw new HttpError(400, "invalid_json", "request body must be valid JSON");
  }
}

export async function pipeToResponse(
  res: http.ServerResponse,
  payload: { stream: NodeJS.ReadableStream; contentType?: string; fileName?: string },
): Promise<void> {
  if (payload.contentType) res.setHeader("content-type", payload.contentType);
  if (payload.fileName) res.setHeader("content-disposition", `inline; filename="${payload.fileName.replace(/"/g, "")}"`);
  await pipeline(payload.stream, res);
}

export function buildUploadID(): string {
  return `up_${randomUUID().replace(/-/g, "")}`;
}

export function buildAssetID(): string {
  return `ast_${randomUUID().replace(/-/g, "")}`;
}

export function publicRoute(route: GatewayRoute, status: GatewayRouteStatus | null) {
  return {
    routeID: route.routeID,
    provider: route.provider,
    accountID: route.accountID,
    chatID: route.chatID,
    chatName: route.chatName,
    enabled: route.enabled,
    sessionBindingID: route.sessionBindingID,
    status,
    updatedAt: route.updatedAt,
  };
}

export function publicMessage(message: GatewayMessageSummary) {
  return {
    messageID: message.messageID,
    routeID: message.routeID,
    msgType: message.msgType,
    createTime: message.createTime,
    senderType: message.senderType,
    preview: message.preview,
    hasResource: Boolean(message.resourceType && message.resourceKey),
    resourceType: message.resourceType || null,
  };
}

export function accountPublic(account: GatewayAccount, runtimeInfo: Record<string, unknown> | null) {
  return {
    provider: account.provider,
    accountID: account.accountID,
    displayName: account.displayName,
    enabled: account.enabled,
    updatedAt: account.updatedAt,
    runtimeInfo,
  };
}

export function bindingPublic(binding: GatewaySessionBinding) {
  return structuredClone(binding);
}

export function makeSessionBinding(input: Partial<GatewaySessionBinding> & { sessionBindingID: string }): GatewaySessionBinding {
  const now = new Date().toISOString();
  return {
    sessionBindingID: input.sessionBindingID.trim(),
    enabled: input.enabled !== false,
    runtimeID: input.runtimeID?.trim() || "",
    sessionID: input.sessionID?.trim() || "",
    directory: input.directory?.trim() || "",
    displayID: input.displayID?.trim() || "",
    title: input.title?.trim() || "",
    model: input.model?.trim() || "",
    createdAt: input.createdAt?.trim() || now,
    updatedAt: now,
  };
}

export function listen(server: http.Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

export function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
