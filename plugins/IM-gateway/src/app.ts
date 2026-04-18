import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import type { PluginContext } from "@opensessiongateway/server-plugin-sdk";

import type { ImBridgeConfig } from "./config.js";
import { GatewayProviderRegistry, type GatewayProviderAccountRuntime, type GatewayProviderInboundEvent, type GatewayProviderPlugin } from "./provider.js";
import { StateStore } from "./state.js";
import type {
  GatewayAccount,
  GatewayAsset,
  GatewayChatSummary,
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

type LogLevel = "debug" | "info" | "warn" | "error";

type SessionStatusChangeEvent = {
  kind: "snapshot" | "change" | "resync" | "disconnect";
  source: "snapshot" | "client_content" | "runtime_connect" | "runtime_disconnect";
  current: {
    runtimeID: string;
    sessionID: string;
    runtimeStatus: "online" | "offline" | "stale" | string;
    sessionStatus: "idle" | "busy" | "error" | null;
    currentStatus: string | null;
    title: string | null;
    displayID: string | null;
    instanceWorkspaceDirectory: string | null;
    runtimeHost: string | null;
    lastActiveTime: string | null;
    updatedAt: string;
  };
};

type SessionStatusChangeHook = {
  (target: { runtimeID: string; sessionID: string }, listener: (event: SessionStatusChangeEvent) => void | Promise<void>): () => void;
  (
    target: { runtimeID: string; sessionID: string },
    options: { emitCurrent?: boolean },
    listener: (event: SessionStatusChangeEvent) => void | Promise<void>,
  ): () => void;
};

type AccountRuntimeEntry = {
  account: GatewayAccount;
  provider: GatewayProviderPlugin;
  runtime: GatewayProviderAccountRuntime;
  webhookPath: string;
  webhookHandler: ((req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>) | null;
};

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const STATUS_BUSY_REACTION_EMOJI = "Typing";

class HttpError extends Error {
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

function createLogger(level: string, ctx: PluginContext) {
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

function readSessionStatusHook(ctx: PluginContext): SessionStatusChangeHook | null {
  const hooks = ctx.hooks as typeof ctx.hooks & { onSessionStatusChange?: SessionStatusChangeHook };
  return typeof hooks.onSessionStatusChange === "function" ? hooks.onSessionStatusChange : null;
}

function toStatusLabel(input: { runtimeStatus?: string | null; sessionStatus?: string | null; currentStatus?: string | null }): "idle" | "busy" | "error" | "offline" | null {
  const runtimeStatus = (input.runtimeStatus || "").trim().toLowerCase();
  if (runtimeStatus === "offline") return "offline";
  const sessionStatus = (input.sessionStatus || "").trim().toLowerCase();
  if (sessionStatus === "idle" || sessionStatus === "busy" || sessionStatus === "error") return sessionStatus;
  const currentStatus = (input.currentStatus || "").trim().toLowerCase();
  if (currentStatus === "idle") return "idle";
  if (currentStatus === "error" || currentStatus === "interrupted") return "error";
  if (currentStatus) return "busy";
  return null;
}

function json(res: http.ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

function publicHost(host: string): string {
  const clean = host.trim();
  if (!clean || clean === "0.0.0.0" || clean === "::") return "127.0.0.1";
  return clean;
}

function normalizePath(value: string): string {
  const clean = value.trim();
  return clean.startsWith("/") ? clean : `/${clean}`;
}

function queryLimit(url: URL, key: string, fallback: number, max = 50): number {
  const raw = url.searchParams.get(key)?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.max(1, Math.floor(parsed)));
}

function requireString(value: unknown, name: string): string {
  const clean = typeof value === "string" ? value.trim() : "";
  if (!clean) throw new Error(`${name} is required`);
  return clean;
}

function requireType(value: unknown, name: string): GatewayResourceType | "image" | "file" {
  const clean = requireString(value, name);
  if (clean === "image" || clean === "file" || clean === "audio" || clean === "media") return clean;
  throw new Error(`${name} must be one of image/file/audio/media`);
}

function splitPathname(pathname: string): string[] {
  return pathname.split("/").filter(Boolean).map((item) => decodeURIComponent(item));
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  if (!raw.length) return {};
  try {
    const parsed = JSON.parse(raw.toString("utf8"));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    throw new HttpError(400, "invalid_json", "request body must be valid JSON");
  }
}

async function pipeToResponse(
  res: http.ServerResponse,
  payload: { stream: NodeJS.ReadableStream; contentType?: string; fileName?: string },
): Promise<void> {
  if (payload.contentType) res.setHeader("content-type", payload.contentType);
  if (payload.fileName) res.setHeader("content-disposition", `inline; filename="${payload.fileName.replace(/"/g, "")}"`);
  await pipeline(payload.stream, res);
}

function buildUploadID(): string {
  return `up_${randomUUID().replace(/-/g, "")}`;
}

function buildAssetID(): string {
  return `ast_${randomUUID().replace(/-/g, "")}`;
}

function publicRoute(route: GatewayRoute, status: GatewayRouteStatus | null) {
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

function publicMessage(message: GatewayMessageSummary) {
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

function accountPublic(account: GatewayAccount, runtimeInfo: Record<string, unknown> | null) {
  return {
    provider: account.provider,
    accountID: account.accountID,
    displayName: account.displayName,
    enabled: account.enabled,
    updatedAt: account.updatedAt,
    runtimeInfo,
  };
}

function bindingPublic(binding: GatewaySessionBinding) {
  return structuredClone(binding);
}

function makeSessionBinding(input: Partial<GatewaySessionBinding> & { sessionBindingID: string }): GatewaySessionBinding {
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

function listen(server: http.Server, port: number, host: string): Promise<void> {
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

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

export class ImBridgeApp {
  readonly config: ImBridgeConfig;
  readonly logger;
  readonly stateStore;
  readonly registry;
  private readonly ctx: PluginContext;
  private server: http.Server | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private readonly accountRuntimes = new Map<string, AccountRuntimeEntry>();
  private readonly statusWatchStops = new Map<string, () => void>();

  constructor(config: ImBridgeConfig, ctx: PluginContext) {
    this.config = config;
    this.ctx = ctx;
    this.logger = createLogger(config.logLevel, ctx);
    this.stateStore = new StateStore(config.stateFilePath);
    this.registry = new GatewayProviderRegistry();
  }

  async start(): Promise<void> {
    await this.stateStore.ensure();
    await fs.mkdir(this.config.uploadDir, { recursive: true });
    for (const account of await this.stateStore.listAccounts()) {
      if (!account.enabled) continue;
      await this.startAccountRuntime(account);
    }
    this.server = http.createServer((req, res) => {
      void this.handleHttpRequest(req, res);
    });
    await listen(this.server, this.config.port, this.config.host);
    await this.refreshStatusWatches();
    if (this.config.pollEnabled) {
      this.pollTimer = setInterval(() => {
        void this.pollRoutes().catch((error) => {
          this.logger.warn("im gateway poll failed", { message: error instanceof Error ? error.message : String(error) });
        });
      }, this.config.pollIntervalMs);
    }
    this.logger.info("im gateway plugin started", {
      host: this.config.host,
      port: this.config.port,
      routePrefix: this.config.routePrefix,
      stateFilePath: this.config.stateFilePath,
    });
  }

  async stop(): Promise<void> {
    for (const stop of this.statusWatchStops.values()) stop();
    this.statusWatchStops.clear();
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    await Promise.all([...this.accountRuntimes.values()].map(async (entry) => entry.runtime.stop?.()));
    this.accountRuntimes.clear();
    const server = this.server;
    this.server = null;
    if (server) await close(server);
  }

  getTransferEndpoint() {
    const host = publicHost(this.config.host);
    return {
      address: `${host}:${this.config.port}`,
      requestUploadURL: `http://${host}:${this.config.port}/${this.config.routePrefix}/uploads/{uploadID}`,
      assetURLPrefix: `http://${host}:${this.config.port}/${this.config.routePrefix}/assets/`,
    };
  }

  async getGatewayInfo() {
    const state = await this.stateStore.load();
    return {
      pluginID: this.ctx.pluginID,
      pluginName: this.ctx.manifest.name || this.ctx.pluginID,
      host: this.config.host,
      port: this.config.port,
      routePrefix: this.config.routePrefix,
      providers: this.registry.listProviders(),
      accountCount: Object.keys(state.accounts).length,
      sessionBindingCount: Object.keys(state.sessionBindings).length,
      routeCount: Object.keys(state.routes).length,
      uploadCount: Object.keys(state.uploads).length,
      assetCount: Object.keys(state.assets).length,
      lastRouteSyncAt: state.lastRouteSyncAt,
      lastEventAt: state.lastEventAt,
      sessionStatusTransport: readSessionStatusHook(this.ctx) ? "hook" : "none",
    };
  }

  listProviders() {
    return this.registry.listProviders();
  }

  async listAccounts() {
    const accounts = await this.stateStore.listAccounts();
    const items = await Promise.all(accounts.map(async (account) => {
      const runtimeInfo = await this.accountRuntimes.get(accountKeyOf(account.provider, account.accountID))?.runtime.getRuntimeInfo?.() ?? null;
      return accountPublic(account, runtimeInfo);
    }));
    return { count: items.length, items };
  }

  async upsertAccount(input: {
    provider: string;
    accountID: string;
    displayName?: string;
    enabled?: boolean;
    config?: Record<string, unknown>;
  }) {
    const provider = this.registry.getProvider(requireString(input.provider, "provider"));
    const accountID = requireString(input.accountID, "accountID");
    const previous = await this.stateStore.getAccount(provider.id, accountID);
    const now = new Date().toISOString();
    const config = provider.normalizeAccountConfig ? provider.normalizeAccountConfig(input.config || {}) : (input.config || {});
    const account: GatewayAccount = {
      provider: provider.id,
      accountID,
      displayName: input.displayName?.trim() || previous?.displayName || accountID,
      enabled: input.enabled ?? previous?.enabled ?? true,
      config,
      createdAt: previous?.createdAt || now,
      updatedAt: now,
    };
    await this.stateStore.upsertAccount(account);
    if (account.enabled) {
      await this.startAccountRuntime(account);
    } else {
      await this.stopAccountRuntime(account.provider, account.accountID);
    }
    return accountPublic(account, await this.accountRuntimes.get(accountKeyOf(account.provider, account.accountID))?.runtime.getRuntimeInfo?.() ?? null);
  }

  async deleteAccount(providerID: string, accountID: string) {
    const account = await this.stateStore.getAccount(providerID.trim().toLowerCase(), accountID);
    if (!account || account.provider !== providerID.trim().toLowerCase()) throw new Error(`account not found: ${providerID}/${accountID}`);
    const routes = (await this.stateStore.listRoutes()).filter((route) => route.accountID === accountID && route.provider === account.provider);
    if (routes.length) throw new Error(`account still has routes: ${routes.map((item) => item.routeID).join(", ")}`);
    await this.stopAccountRuntime(account.provider, accountID);
    await this.stateStore.removeAccount(account.provider, accountID);
    return { ok: true, provider: account.provider, accountID };
  }

  async listAccountChats(providerID: string, accountID: string, options?: { limit?: number; refresh?: boolean }) {
    const account = await this.requireAccount(providerID, accountID);
    const runtime = await this.requireAccountRuntime(account.provider, account.accountID);
    const limit = Math.min(50, Math.max(1, Math.floor(options?.limit || this.config.chatPageSize)));
    const chats = await runtime.listChats(limit);
    return {
      provider: account.provider,
      accountID: account.accountID,
      count: chats.length,
      items: chats.map((chat) => ({
        routeID: routeIDOf(account.provider, account.accountID, chat.chatID),
        chatID: chat.chatID,
        name: chat.name,
        chatMode: chat.chatMode,
        chatType: chat.chatType,
        userCount: chat.userCount,
        botCount: chat.botCount,
        ownerID: chat.ownerID,
        ownerIDType: chat.ownerIDType,
        external: chat.external,
        lastMessageTime: chat.lastMessageTime,
        lastMessagePreview: chat.lastMessagePreview,
        detailError: chat.detailError,
      })),
    };
  }

  async createAccountChat(input: {
    provider: string;
    accountID: string;
    name: string;
    description?: string;
    ownerID?: string;
    userIDs?: string[];
    botIDs?: string[];
    userIDType?: GatewayUserIDType;
    external?: boolean;
    chatMode?: string;
    chatType?: string;
    setBotManager?: boolean;
    uuid?: string;
    sessionBindingID?: string;
    enabled?: boolean;
  }) {
    const account = await this.requireAccount(input.provider, input.accountID);
    if (input.sessionBindingID?.trim()) await this.requireSessionBinding(input.sessionBindingID);
    const runtime = await this.requireAccountRuntime(account.provider, account.accountID);
    if (typeof runtime.createChat !== "function") throw new Error(`provider does not support chat creation: ${account.provider}`);
    const chat = await runtime.createChat({
      name: requireString(input.name, "name"),
      description: input.description?.trim() || undefined,
      ownerID: input.ownerID?.trim() || undefined,
      userIDs: Array.isArray(input.userIDs) ? input.userIDs : [],
      botIDs: Array.isArray(input.botIDs) ? input.botIDs : [],
      userIDType: input.userIDType,
      external: input.external,
      chatMode: input.chatMode?.trim() || undefined,
      chatType: input.chatType?.trim() || undefined,
      setBotManager: input.setBotManager,
      uuid: input.uuid?.trim() || undefined,
    });
    const route = await this.upsertRoute({
      provider: account.provider,
      accountID: account.accountID,
      chatID: chat.chatID,
      chatName: chat.name || input.name,
      enabled: input.enabled,
      sessionBindingID: input.sessionBindingID,
    });
    await this.stateStore.saveChat(route.routeID, structuredClone(chat));
    return {
      provider: account.provider,
      accountID: account.accountID,
      routeID: route.routeID,
      route,
      chat,
    };
  }

  async deleteAccountChat(input: { provider: string; accountID: string; chatID: string; removeRoute?: boolean }) {
    const account = await this.requireAccount(input.provider, input.accountID);
    const runtime = await this.requireAccountRuntime(account.provider, account.accountID);
    if (typeof runtime.deleteChat !== "function") throw new Error(`provider does not support chat deletion: ${account.provider}`);
    const chatID = requireString(input.chatID, "chatID");
    await runtime.deleteChat(chatID);
    const routeID = routeIDOf(account.provider, account.accountID, chatID);
    const route = await this.stateStore.getRoute(routeID);
    if (route && input.removeRoute !== false) {
      await this.stateStore.removeRoute(routeID);
      await this.refreshStatusWatches();
    }
    return {
      ok: true,
      provider: account.provider,
      accountID: account.accountID,
      chatID,
      routeID,
      routeRemoved: Boolean(route && input.removeRoute !== false),
    };
  }

  async listAccountChatMembers(input: {
    provider: string;
    accountID: string;
    chatID: string;
    memberIDType?: GatewayUserIDType;
    limit?: number;
  }) {
    const account = await this.requireAccount(input.provider, input.accountID);
    const runtime = await this.requireAccountRuntime(account.provider, account.accountID);
    if (typeof runtime.listChatMembers !== "function") throw new Error(`provider does not support listing chat members: ${account.provider}`);
    const chatID = requireString(input.chatID, "chatID");
    const result = await runtime.listChatMembers(chatID, {
      memberIDType: input.memberIDType,
      limit: Math.min(500, Math.max(1, Math.floor(input.limit || 100))),
    });
    return {
      provider: account.provider,
      accountID: account.accountID,
      routeID: routeIDOf(account.provider, account.accountID, chatID),
      chatID,
      total: result.total,
      count: result.items.length,
      items: result.items,
    };
  }

  async addAccountChatMembers(input: {
    provider: string;
    accountID: string;
    chatID: string;
    memberIDs: string[];
    memberIDType?: GatewayMemberIDType;
    succeedType?: number;
  }) {
    const account = await this.requireAccount(input.provider, input.accountID);
    const runtime = await this.requireAccountRuntime(account.provider, account.accountID);
    if (typeof runtime.addChatMembers !== "function") throw new Error(`provider does not support adding chat members: ${account.provider}`);
    const chatID = requireString(input.chatID, "chatID");
    const memberIDs = [...new Set((Array.isArray(input.memberIDs) ? input.memberIDs : []).map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean))];
    if (!memberIDs.length) throw new Error("memberIDs is required");
    const result = await runtime.addChatMembers(chatID, {
      memberIDs,
      memberIDType: input.memberIDType,
      succeedType: typeof input.succeedType === "number" ? Math.max(0, Math.floor(input.succeedType)) : undefined,
    });
    const routeID = routeIDOf(account.provider, account.accountID, chatID);
    const route = await this.stateStore.getRoute(routeID);
    if (route) {
      try {
        await this.stateStore.saveChat(routeID, await runtime.getChat(chatID));
      } catch {
        // ignore chat refresh failure after member change
      }
    }
    return {
      provider: account.provider,
      accountID: account.accountID,
      routeID,
      chatID,
      requestedCount: memberIDs.length,
      invalidIDs: result.invalidIDs,
      notExistedIDs: result.notExistedIDs,
      pendingApprovalIDs: result.pendingApprovalIDs,
    };
  }

  async listSessionBindings() {
    const bindings = await this.stateStore.listSessionBindings();
    return { count: bindings.length, items: bindings.map(bindingPublic) };
  }

  async upsertSessionBinding(input: Partial<GatewaySessionBinding> & { sessionBindingID: string }) {
    const previous = await this.stateStore.getSessionBinding(input.sessionBindingID);
    const binding = makeSessionBinding({ ...previous, ...input, createdAt: previous?.createdAt });
    await this.stateStore.upsertSessionBinding(binding);
    await this.refreshStatusWatches();
    return bindingPublic(binding);
  }

  async createSessionBinding(input: {
    sessionBindingID: string;
    runtimeID: string;
    directory: string;
    displayID?: string;
    title?: string;
    content?: string;
    model?: string;
    enabled?: boolean;
  }) {
    const runtimeID = requireString(input.runtimeID, "runtimeID");
    const directory = requireString(input.directory, "directory");
    await this.ctx.osg.requireOnlineRuntime(runtimeID);
    const createNewSession = this.ctx.osg.createNewSession as unknown as (payload: {
      runtimeID: string;
      instanceWorkspaceDirectory: string;
      content: string;
      displayID?: string;
      title?: string;
      model?: string;
    }) => Promise<{ ok?: boolean; sessionID?: string; error?: string }>;
    const created = await createNewSession({
      runtimeID,
      instanceWorkspaceDirectory: directory,
      content: input.content?.trim() || "You are the IM gateway conversation handler.",
      displayID: input.displayID?.trim() || undefined,
      title: input.title?.trim() || undefined,
      model: input.model?.trim() || undefined,
    });
    if (!created?.ok || !created.sessionID) throw new Error(created?.error || "failed to create session");
    return this.upsertSessionBinding({
      sessionBindingID: requireString(input.sessionBindingID, "sessionBindingID"),
      enabled: input.enabled ?? true,
      runtimeID,
      sessionID: created.sessionID,
      directory,
      displayID: input.displayID,
      title: input.title,
      model: input.model,
    });
  }

  async deleteSessionBinding(sessionBindingID: string) {
    const routes = (await this.stateStore.listRoutes()).filter((route) => route.sessionBindingID === sessionBindingID.trim());
    if (routes.length) throw new Error(`sessionBinding still used by routes: ${routes.map((item) => item.routeID).join(", ")}`);
    await this.stateStore.removeSessionBinding(sessionBindingID.trim());
    await this.refreshStatusWatches();
    return { ok: true, sessionBindingID: sessionBindingID.trim() };
  }

  async listRoutes() {
    const routes = await this.stateStore.listRoutes();
    const items = await Promise.all(routes.map(async (route) => publicRoute(route, await this.stateStore.getRouteStatus(route.routeID))));
    return { count: items.length, items };
  }

  async getRoute(routeID: string) {
    const route = await this.requireRoute(routeID);
    const status = await this.stateStore.getRouteStatus(route.routeID);
    return publicRoute(route, status);
  }

  async upsertRoute(input: {
    provider: string;
    accountID: string;
    chatID: string;
    chatName?: string;
    enabled?: boolean;
    sessionBindingID?: string;
  }) {
    const provider = requireString(input.provider, "provider").toLowerCase();
    const account = await this.requireAccount(provider, requireString(input.accountID, "accountID"));
    const chatID = requireString(input.chatID, "chatID");
    const routeID = routeIDOf(provider, account.accountID, chatID);
    const previous = await this.stateStore.getRoute(routeID);
    const sessionBindingID = input.sessionBindingID?.trim() || previous?.sessionBindingID || "";
    if (sessionBindingID) await this.requireSessionBinding(sessionBindingID);
    let chatName = input.chatName?.trim() || previous?.chatName || "";
    if (!chatName) {
      try {
        const runtime = await this.requireAccountRuntime(account.provider, account.accountID);
        chatName = (await runtime.getChat(chatID)).name || chatID;
      } catch {
        chatName = chatID;
      }
    }
    const now = new Date().toISOString();
    const route: GatewayRoute = {
      routeID,
      provider,
      accountID: account.accountID,
      chatID,
      chatName,
      enabled: input.enabled ?? previous?.enabled ?? true,
      sessionBindingID,
      createdAt: previous?.createdAt || now,
      updatedAt: now,
    };
    await this.stateStore.upsertRoute(route);
    await this.refreshStatusWatches();
    return publicRoute(route, await this.stateStore.getRouteStatus(route.routeID));
  }

  async deleteRoute(routeID: string) {
    await this.requireRoute(routeID);
    await this.stateStore.removeRoute(routeID);
    await this.refreshStatusWatches();
    return { ok: true, routeID };
  }

  async listRouteMessages(routeID: string, options?: { limit?: number; refresh?: boolean }) {
    const route = await this.requireRoute(routeID);
    const limit = Math.min(50, Math.max(1, Math.floor(options?.limit || this.config.messagePageSize)));
    if (options?.refresh !== false) {
      await this.refreshRouteMessages(route, limit).catch((error) => {
        this.logger.warn("route message refresh failed", { routeID: route.routeID, message: error instanceof Error ? error.message : String(error) });
      });
    }
    const items = await this.stateStore.getRouteMessages(route.routeID);
    return { routeID: route.routeID, count: Math.min(limit, items.length), items: items.slice(0, limit).map(publicMessage) };
  }

  async sendRouteTextMessage(routeID: string, text: string) {
    const route = await this.requireRoute(routeID);
    const runtime = await this.requireAccountRuntime(route.provider, route.accountID);
    const result = await runtime.sendTextMessage(route.chatID, requireString(text, "text"));
    await this.refreshRouteMessages(route, this.config.messagePageSize).catch(() => undefined);
    return { routeID: route.routeID, ...result };
  }

  async requestUpload(input: { type: "image" | "file"; routeID?: string }) {
    const uploadID = buildUploadID();
    const routeID = input.routeID?.trim() || "";
    if (routeID) await this.requireRoute(routeID);
    const upload: GatewayUpload = {
      uploadID,
      routeID,
      type: input.type,
      fileName: "",
      mimeType: "",
      localPath: path.join(this.config.uploadDir, `${uploadID}.bin`),
      byteLength: 0,
      status: "pending",
      providerRefs: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.stateStore.saveUpload(upload, this.config.uploadCacheLimit);
    return {
      uploadID,
      routeID: upload.routeID || null,
      type: upload.type,
      method: "POST",
      uploadURL: this.buildUploadUrl(uploadID),
    };
  }

  async sendRouteUpload(routeID: string, uploadID: string) {
    const route = await this.requireRoute(routeID);
    const upload = await this.requireUpload(uploadID);
    if (upload.routeID && upload.routeID !== route.routeID) {
      throw new Error(`uploadID is bound to another route: ${upload.routeID}`);
    }
    if (upload.status !== "ready" || !upload.localPath) throw new Error(`uploadID is not ready: ${upload.uploadID}`);
    const runtime = await this.requireAccountRuntime(route.provider, route.accountID);
    const providerRefKey = `${route.provider}::${route.accountID}`;
    let providerRef = upload.providerRefs[providerRefKey] || null;
    if (!providerRef) {
      const content = await fs.readFile(upload.localPath);
      const resourceKey = upload.type === "image"
        ? await runtime.uploadImage(upload.fileName || `${upload.uploadID}.bin`, content, upload.mimeType)
        : await runtime.uploadFile(upload.fileName || `${upload.uploadID}.bin`, content, upload.mimeType);
      providerRef = {
        provider: route.provider,
        accountID: route.accountID,
        resourceType: upload.type,
        resourceKey,
        uploadedAt: new Date().toISOString(),
      };
      upload.providerRefs[providerRefKey] = providerRef;
      upload.routeID = upload.routeID || route.routeID;
      upload.updatedAt = new Date().toISOString();
      await this.stateStore.saveUpload(upload, this.config.uploadCacheLimit);
    }
    const result = providerRef.resourceType === "image"
      ? await runtime.sendImageMessage(route.chatID, providerRef.resourceKey)
      : await runtime.sendFileMessage(route.chatID, providerRef.resourceKey);
    await this.refreshRouteMessages(route, this.config.messagePageSize).catch(() => undefined);
    return { routeID: route.routeID, ...result, uploadID: upload.uploadID };
  }

  async requestDownload(input: { routeID: string; messageID: string; type: GatewayResourceType }) {
    const route = await this.requireRoute(input.routeID);
    const message = await this.requireRouteMessage(route, requireString(input.messageID, "messageID"));
    const type = requireType(input.type, "type") as GatewayResourceType;
    if (!message.resourceType || !message.resourceKey) throw new Error(`message has no downloadable resource: ${message.messageID}`);
    if (message.resourceType !== type) throw new Error(`message resource type mismatch: expected ${type}, got ${message.resourceType}`);
    const asset: GatewayAsset = {
      assetID: buildAssetID(),
      routeID: route.routeID,
      provider: route.provider,
      accountID: route.accountID,
      chatID: route.chatID,
      messageID: message.messageID,
      type,
      resourceKey: message.resourceKey,
      createdAt: new Date().toISOString(),
    };
    await this.stateStore.saveAsset(asset, this.config.assetCacheLimit);
    return {
      assetID: asset.assetID,
      routeID: asset.routeID,
      type: asset.type,
      downloadURL: this.buildAssetUrl(asset.assetID),
    };
  }

  async listRecentRouteEvents(routeID: string, limit: number) {
    await this.requireRoute(routeID);
    const items = await this.stateStore.listRecentInboundEvents(routeID, limit);
    return { routeID, count: items.length, items };
  }

  private async startAccountRuntime(account: GatewayAccount): Promise<void> {
      await this.stopAccountRuntime(account.provider, account.accountID);
    const provider = this.registry.getProvider(account.provider);
    const runtime = provider.createAccountRuntime({
      account,
      gatewayConfig: this.config,
      onInboundEvent: async (event) => {
        await this.handleProviderInbound(account, event);
      },
    });
    await runtime.start?.();
    const webhookPath = normalizePath(`/${this.config.routePrefix}/webhooks/${provider.id}/${encodeURIComponent(account.accountID)}`);
    const webhookHandler = runtime.createWebhookHandler?.(webhookPath) || null;
    this.accountRuntimes.set(accountKeyOf(account.provider, account.accountID), { account, provider, runtime, webhookPath, webhookHandler });
  }

  private async stopAccountRuntime(provider: string, accountID: string): Promise<void> {
    const key = accountKeyOf(provider, accountID);
    const entry = this.accountRuntimes.get(key);
    if (!entry) return;
    this.accountRuntimes.delete(key);
    await entry.runtime.stop?.();
  }

  private async requireAccount(providerID: string, accountID: string): Promise<GatewayAccount> {
    const account = await this.stateStore.getAccount(providerID.trim().toLowerCase(), accountID.trim());
    if (!account || account.provider !== providerID.trim().toLowerCase()) throw new Error(`account not found: ${providerID}/${accountID}`);
    return account;
  }

  private async requireAccountRuntime(provider: string, accountID: string): Promise<GatewayProviderAccountRuntime> {
    const entry = this.accountRuntimes.get(accountKeyOf(provider, accountID));
    if (!entry) throw new Error(`account runtime is not active: ${provider}/${accountID}`);
    return entry.runtime;
  }

  private async requireRoute(routeID: string): Promise<GatewayRoute> {
    const route = await this.stateStore.getRoute(routeID.trim());
    if (!route) throw new Error(`route not found: ${routeID}`);
    return route;
  }

  private async requireSessionBinding(sessionBindingID: string): Promise<GatewaySessionBinding> {
    const binding = await this.stateStore.getSessionBinding(sessionBindingID.trim());
    if (!binding) throw new Error(`sessionBinding not found: ${sessionBindingID}`);
    return binding;
  }

  private async requireUpload(uploadID: string): Promise<GatewayUpload> {
    const upload = await this.stateStore.getUpload(uploadID.trim());
    if (!upload) throw new Error(`upload not found: ${uploadID}`);
    return upload;
  }

  private async requireRouteMessage(route: GatewayRoute, messageID: string): Promise<GatewayMessageSummary> {
    let messages = await this.stateStore.getRouteMessages(route.routeID);
    let match = messages.find((item) => item.messageID === messageID);
    if (match) return match;
    await this.refreshRouteMessages(route, this.config.messagePageSize);
    messages = await this.stateStore.getRouteMessages(route.routeID);
    match = messages.find((item) => item.messageID === messageID);
    if (!match) throw new Error(`message not found in route: ${messageID}`);
    return match;
  }

  private buildUploadUrl(uploadID: string): string {
    const host = publicHost(this.config.host);
    return `http://${host}:${this.config.port}/${this.config.routePrefix}/uploads/${encodeURIComponent(uploadID)}`;
  }

  private buildAssetUrl(assetID: string): string {
    const host = publicHost(this.config.host);
    return `http://${host}:${this.config.port}/${this.config.routePrefix}/assets/${encodeURIComponent(assetID)}`;
  }

  private async refreshRouteMessages(route: GatewayRoute, limit: number): Promise<void> {
    const runtime = await this.requireAccountRuntime(route.provider, route.accountID);
    const messages = await runtime.listChatMessages(route.chatID, limit);
    const normalized = messages.map((item) => ({ ...item, routeID: route.routeID, provider: route.provider, accountID: route.accountID, chatID: route.chatID }));
    await this.stateStore.replaceRouteMessages(route.routeID, normalized, this.config.messageCacheLimit);
  }

  private buildInboundUserMessage(event: GatewayInboundEvent): string {
    if (event.msgType === "text") {
      try {
        const parsed = JSON.parse(event.content || "{}") as { text?: unknown };
        if (typeof parsed.text === "string" && parsed.text.trim()) return parsed.text.trim();
      } catch {
        // ignore
      }
    }
    if (event.preview.trim()) return event.preview.trim();
    if (event.content.trim()) return event.content.trim();
    if (event.msgType === "image") return "[User sent an image]";
    if (event.msgType === "file") return "[User sent a file]";
    if (event.msgType === "audio") return "[User sent audio]";
    if (event.msgType === "media") return "[User sent media]";
    return `[User sent ${event.msgType || "a message"}]`;
  }

  private buildInboundSystemPrompt(route: GatewayRoute, binding: GatewaySessionBinding, event: GatewayInboundEvent): string {
    const lines = [
      "<IMGatewayInboundEvent>",
      `routeID=${route.routeID}`,
      `provider=${route.provider}`,
      `accountID=${route.accountID}`,
      `chatID=${route.chatID}`,
      `chatName=${event.chatName || route.chatName}`,
      `messageID=${event.messageID}`,
      `msgType=${event.msgType}`,
      `resourceType=${event.resourceType}`,
      `resourceKey=${event.resourceKey}`,
      `senderID=${event.senderID}`,
      `senderOpenID=${event.senderOpenID}`,
      `senderType=${event.senderType}`,
      `createTime=${event.createTime || ""}`,
      `receivedAt=${event.receivedAt}`,
      `preview=${event.preview}`,
      "</IMGatewayInboundEvent>",
      "",
      "<Instructions>",
      `- Reply to this IM conversation by calling IM Gateway route tools with routeID ${route.routeID}.`,
      `- This route currently binds to sessionBindingID ${binding.sessionBindingID}.`,
      "- Use SendRouteTextMessage for text replies.",
      "- Use RequestUpload plus SendRouteUpload for file/image replies.",
      "- Do not answer in plain text only if the user expects an IM reply.",
      "</Instructions>",
    ];
    return lines.join("\n");
  }

  private async noteRouteTargetIssue(route: GatewayRoute, label: "offline" | "missing_session", detail: string): Promise<void> {
    const previous = await this.stateStore.getRouteStatus(route.routeID);
    await this.applyRouteStatus(route, label, detail);
    if (previous?.label === label && (previous.detail || "") === detail) return;
    this.logger.warn("route target unavailable", {
      routeID: route.routeID,
      sessionBindingID: route.sessionBindingID,
      label,
      message: detail,
    });
  }

  private async verifyRouteBindingTarget(route: GatewayRoute, binding: GatewaySessionBinding): Promise<boolean> {
    if (!binding.enabled || !binding.runtimeID || !binding.sessionID) {
      await this.noteRouteTargetIssue(route, "offline", "session binding is incomplete or disabled");
      return false;
    }
    const runtimeOnline = await this.ctx.osg.hasOnlineRuntime(binding.runtimeID).catch(() => false);
    if (!runtimeOnline) {
      await this.noteRouteTargetIssue(route, "offline", `runtime offline: ${binding.runtimeID}`);
      return false;
    }
    const sessionOnline = await this.ctx.osg.hasOnlineRuntimeSession(binding.runtimeID, binding.sessionID).catch(() => false);
    if (!sessionOnline) {
      await this.noteRouteTargetIssue(route, "missing_session", `session not found: ${binding.sessionID}`);
      return false;
    }
    return true;
  }

  private async forwardInboundEventToOsg(route: GatewayRoute, event: GatewayInboundEvent): Promise<void> {
    if (!route.enabled || !route.sessionBindingID) return;
    const binding = await this.requireSessionBinding(route.sessionBindingID);
    if (!binding.enabled || !binding.runtimeID || !binding.sessionID) return;
    if (!await this.verifyRouteBindingTarget(route, binding)) return;
    const forwardKey = `${route.routeID}::${event.messageID}`;
    if (await this.stateStore.hasForwardedInbound(forwardKey)) return;
    const addPrompt = this.ctx.osg.addPrompt as (payload: {
      runtimeID: string;
      sessionID: string;
      msg: string;
      model?: string;
      system?: string;
    }) => Promise<{ ok: boolean; error?: string }>;
    const response = await addPrompt({
      runtimeID: binding.runtimeID,
      sessionID: binding.sessionID,
      msg: this.buildInboundUserMessage(event),
      model: binding.model || undefined,
      system: this.buildInboundSystemPrompt(route, binding, event),
    });
    if (!response?.ok) {
      const message = response?.error || "failed to forward inbound event to OSG";
      if (/instance not found/i.test(message) || /session not found/i.test(message)) {
        await this.noteRouteTargetIssue(route, "missing_session", message);
        return;
      }
      throw new Error(message);
    }
    await this.stateStore.markForwardedInbound(forwardKey, this.config.forwardedInboundCacheLimit);
  }

  private async ensureRouteForInbound(account: GatewayAccount, event: GatewayProviderInboundEvent): Promise<GatewayRoute> {
    const routeID = routeIDOf(account.provider, account.accountID, event.chatID);
    const existing = await this.stateStore.getRoute(routeID);
    if (existing) {
      if (event.chatName && event.chatName !== existing.chatName) {
        const updated = { ...existing, chatName: event.chatName, updatedAt: new Date().toISOString() };
        await this.stateStore.upsertRoute(updated);
        return updated;
      }
      return existing;
    }
    const route: GatewayRoute = {
      routeID,
      provider: account.provider,
      accountID: account.accountID,
      chatID: event.chatID,
      chatName: event.chatName || event.chatID,
      enabled: true,
      sessionBindingID: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.stateStore.upsertRoute(route);
    return route;
  }

  private async handleProviderInbound(account: GatewayAccount, event: GatewayProviderInboundEvent): Promise<void> {
    const route = await this.ensureRouteForInbound(account, event);
    const inbound: GatewayInboundEvent = {
      routeID: route.routeID,
      provider: route.provider,
      accountID: route.accountID,
      chatID: route.chatID,
      chatName: event.chatName || route.chatName,
      messageID: event.messageID,
      msgType: event.msgType,
      resourceType: event.resourceType,
      resourceKey: event.resourceKey,
      senderID: event.senderID,
      senderOpenID: event.senderOpenID,
      senderType: event.senderType,
      preview: event.preview,
      content: event.content,
      createTime: event.createTime,
      receivedAt: event.receivedAt,
      updatedAt: event.updatedAt,
    };
    await this.stateStore.appendInboundEvent(inbound, this.config.recentEventLimit, this.config.messageCacheLimit);
    await this.forwardInboundEventToOsg(route, inbound);
  }

  private async pollRoutes(): Promise<void> {
    const routes = (await this.stateStore.listRoutes()).filter((route) => route.enabled);
    for (const route of routes) {
      const entry = this.accountRuntimes.get(accountKeyOf(route.provider, route.accountID));
      if (!entry) continue;
      try {
        const messages = await entry.runtime.listChatMessages(route.chatID, this.config.messagePageSize);
        const normalized = messages.map((item) => ({ ...item, routeID: route.routeID, provider: route.provider, accountID: route.accountID, chatID: route.chatID }));
        await this.stateStore.replaceRouteMessages(route.routeID, normalized, this.config.messageCacheLimit);
        const userMessages = [...normalized]
          .filter((item) => item.senderType === "user")
          .sort((a, b) => Date.parse(a.createTime || "1970-01-01") - Date.parse(b.createTime || "1970-01-01"));
        if (userMessages.length > 0 && route.sessionBindingID) {
          const binding = await this.stateStore.getSessionBinding(route.sessionBindingID);
          if (binding && !await this.verifyRouteBindingTarget(route, binding)) continue;
        }
        for (const message of userMessages) {
          const forwardKey = `${route.routeID}::${message.messageID}`;
          if (await this.stateStore.hasForwardedInbound(forwardKey)) continue;
          await this.handleProviderInbound(entry.account, {
            messageID: message.messageID,
            chatID: route.chatID,
            chatName: route.chatName,
            msgType: message.msgType,
            resourceType: message.resourceType,
            resourceKey: message.resourceKey,
            senderID: message.senderID,
            senderOpenID: "",
            senderType: message.senderType,
            preview: message.preview,
            content: message.content,
            createTime: message.createTime,
            receivedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
      } catch (error) {
        this.logger.warn("route poll failed", { routeID: route.routeID, message: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  private async refreshStatusWatches(): Promise<void> {
    const hook = readSessionStatusHook(this.ctx);
    if (!hook) return;
    const routes = (await this.stateStore.listRoutes()).filter((route) => route.enabled && route.sessionBindingID);
    const bindings = await this.stateStore.listSessionBindings();
    const bindingMap = new Map<string, GatewaySessionBinding>(bindings.map((binding) => [binding.sessionBindingID, binding]));
    const desired = new Map<string, GatewaySessionBinding>();
    for (const route of routes) {
      const binding = bindingMap.get(route.sessionBindingID);
      if (!binding?.enabled || !binding.runtimeID || !binding.sessionID) continue;
      desired.set(`${binding.runtimeID}::${binding.sessionID}`, binding);
    }
    for (const [key, stop] of this.statusWatchStops.entries()) {
      if (desired.has(key)) continue;
      stop();
      this.statusWatchStops.delete(key);
    }
    for (const [key, binding] of desired.entries()) {
      if (this.statusWatchStops.has(key)) continue;
      const stop = hook({ runtimeID: binding.runtimeID, sessionID: binding.sessionID }, { emitCurrent: true }, async (event) => {
        await this.handleBindingStatusEvent(binding, event);
      });
      this.statusWatchStops.set(key, stop);
    }
  }

  private async handleBindingStatusEvent(binding: GatewaySessionBinding, event: SessionStatusChangeEvent): Promise<void> {
    const label = toStatusLabel({
      runtimeStatus: event.current.runtimeStatus,
      sessionStatus: event.current.sessionStatus,
      currentStatus: event.current.currentStatus,
    });
    if (!label) return;
    const routes = (await this.stateStore.listRoutes()).filter((route) => route.enabled && route.sessionBindingID === binding.sessionBindingID);
    for (const route of routes) {
      await this.applyRouteStatus(route, label).catch((error) => {
        this.logger.warn("route status sync failed", { routeID: route.routeID, message: error instanceof Error ? error.message : String(error) });
      });
    }
  }

  private async applyRouteStatus(route: GatewayRoute, label: "idle" | "busy" | "error" | "offline" | "missing_session", detail = ""): Promise<void> {
    const previous = await this.stateStore.getRouteStatus(route.routeID);
    const runtime = this.accountRuntimes.get(accountKeyOf(route.provider, route.accountID))?.runtime;
    if (runtime?.addMessageReaction && runtime?.removeMessageReaction) {
      if (label === "busy") {
        const targetMessageID = previous?.targetMessageID || (await this.stateStore.listRecentInboundEvents(route.routeID, 1))[0]?.messageID || "";
        if (!targetMessageID) {
          await this.stateStore.saveRouteStatus({ routeID: route.routeID, label, targetMessageID: "", reactionID: "", reactionEmojiType: STATUS_BUSY_REACTION_EMOJI, detail, updatedAt: new Date().toISOString() });
          return;
        }
        if (previous?.label === "busy" && previous.targetMessageID === targetMessageID && previous.reactionID) return;
        if (previous?.reactionID && previous.targetMessageID && previous.targetMessageID !== targetMessageID) {
          await runtime.removeMessageReaction(previous.targetMessageID, previous.reactionID).catch(() => undefined);
        }
        const created = await runtime.addMessageReaction(targetMessageID, STATUS_BUSY_REACTION_EMOJI);
        await this.stateStore.saveRouteStatus({ routeID: route.routeID, label, targetMessageID, reactionID: created.reactionID, reactionEmojiType: created.emojiType, detail, updatedAt: new Date().toISOString() });
        return;
      }
      if (previous?.reactionID && previous.targetMessageID) {
        await runtime.removeMessageReaction(previous.targetMessageID, previous.reactionID).catch(() => undefined);
      }
      await this.stateStore.saveRouteStatus({
        routeID: route.routeID,
        label,
        targetMessageID: previous?.targetMessageID || "",
        reactionID: "",
        reactionEmojiType: previous?.reactionEmojiType || STATUS_BUSY_REACTION_EMOJI,
        detail,
        updatedAt: new Date().toISOString(),
      });
      return;
    }
    if (label === "busy") {
      await this.stateStore.saveRouteStatus({
        routeID: route.routeID,
        label,
        targetMessageID: previous?.targetMessageID || "",
        reactionID: "",
        reactionEmojiType: previous?.reactionEmojiType || STATUS_BUSY_REACTION_EMOJI,
        detail,
        updatedAt: new Date().toISOString(),
      });
      return;
    }
    await this.stateStore.saveRouteStatus({
      routeID: route.routeID,
      label,
      targetMessageID: previous?.targetMessageID || "",
      reactionID: "",
      reactionEmojiType: previous?.reactionEmojiType || "",
      detail,
      updatedAt: new Date().toISOString(),
    });
  }

  private async handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || `${this.config.host}:${this.config.port}`}`);
      const parts = splitPathname(url.pathname);
      if (parts.length >= 1 && parts[0] === this.config.routePrefix) {
        if (parts[1] === "health" && req.method === "GET") {
          json(res, 200, { ok: true, name: "im-gateway-plugin", gateway: await this.getGatewayInfo() });
          return;
        }
        if (parts[1] === "uploads" && parts[2] && req.method === "POST") {
          await this.handleUploadWrite(parts[2], req, res);
          return;
        }
        if (parts[1] === "assets" && parts[2] && req.method === "GET") {
          await this.handleAssetDownload(parts[2], res);
          return;
        }
        if (parts[1] === "webhooks" && parts[2] && parts[3]) {
          await this.handleProviderWebhook(parts[2], parts[3], req, res);
          return;
        }
      }
      json(res, 404, { ok: false, error: "not_found" });
    } catch (error) {
      if (error instanceof HttpError) {
        json(res, error.status, { ok: false, error: error.code, message: error.message });
        return;
      }
      json(res, 500, { ok: false, error: "internal_error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  private async handleProviderWebhook(providerID: string, accountID: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const entry = this.accountRuntimes.get(accountKeyOf(providerID, accountID));
    if (!entry || entry.provider.id !== providerID || !entry.webhookHandler) {
      throw new HttpError(404, "webhook_not_found", `webhook target not found: ${providerID}/${accountID}`);
    }
    await entry.webhookHandler(req, res);
  }

  private async handleUploadWrite(uploadID: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const upload = await this.requireUpload(uploadID);
    const body = await readBody(req);
    if (!body.length) throw new HttpError(400, "empty_body", "upload body is required");
    await fs.mkdir(this.config.uploadDir, { recursive: true });
    await fs.writeFile(upload.localPath, body);
    upload.status = "ready";
    upload.byteLength = body.length;
    upload.fileName = (Array.isArray(req.headers["x-file-name"]) ? req.headers["x-file-name"][0] : req.headers["x-file-name"])?.trim() || `${upload.uploadID}.bin`;
    upload.mimeType = (Array.isArray(req.headers["content-type"]) ? req.headers["content-type"][0] : req.headers["content-type"])?.trim() || "application/octet-stream";
    upload.updatedAt = new Date().toISOString();
    await this.stateStore.saveUpload(upload, this.config.uploadCacheLimit);
    json(res, 200, { ok: true, data: { uploadID: upload.uploadID, status: upload.status, byteLength: upload.byteLength, fileName: upload.fileName } });
  }

  private async handleAssetDownload(assetID: string, res: http.ServerResponse): Promise<void> {
    const asset = await this.stateStore.getAsset(assetID);
    if (!asset) throw new HttpError(404, "asset_not_found", `asset not found: ${assetID}`);
    const runtime = await this.requireAccountRuntime(asset.provider, asset.accountID);
    const payload = await runtime.downloadResource(asset.messageID, asset.resourceKey, asset.type);
    res.statusCode = 200;
    await pipeToResponse(res, payload);
  }
}
