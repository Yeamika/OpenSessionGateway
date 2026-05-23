import http from "node:http";

import type { PluginContext } from "@opensessiongateway/server-plugin-sdk";

import type { ImBridgeConfig } from "./config.js";
import { GatewayProviderRegistry, type GatewayProviderAccountRuntime } from "./provider.js";
import { StateStore } from "./state.js";
import type {
  GatewayAccount,
  GatewayInboundEvent,
  GatewayMemberIDType,
  GatewayMessageSummary,
  GatewayRoute,
  GatewaySessionBinding,
  GatewayUpload,
  GatewayUserIDType,
} from "./types.js";
import { accountKeyOf, routeIDOf } from "./types.js";

import {
  type AccountRuntimeEntry,
  type SessionStatusChangeEvent,
  accountPublic,
  bindingPublic,
  createLogger,
  listen,
  close,
  makeSessionBinding,
  normalizePath,
  publicHost,
  publicRoute,
  readSessionStatusHook,
  requireString,
  toStatusLabel,
} from "./app_helpers.js";

import { handleHttpRequest, type AppHttpDeps } from "./app_http.js";

import {
  applyRouteStatus,
  handleProviderInbound as _handleProviderInbound,
  pollRoutes as _pollRoutes,
  type AppInboundDeps,
} from "./app_inbound.js";

import {
  listRouteMessages as _listRouteMessages,
  sendRouteTextMessage as _sendRouteTextMessage,
  requestUpload as _requestUpload,
  sendRouteUpload as _sendRouteUpload,
  requestDownload as _requestDownload,
  listRecentRouteEvents as _listRecentRouteEvents,
  type AppResourceDeps,
} from "./app_resources.js";

import {
  listAccounts as _listAccounts,
  upsertAccount as _upsertAccount,
  deleteAccount as _deleteAccount,
  listAccountChats as _listAccountChats,
  createAccountChat as _createAccountChat,
  deleteAccountChat as _deleteAccountChat,
  listAccountChatMembers as _listAccountChatMembers,
  addAccountChatMembers as _addAccountChatMembers,
  type AppAccountDeps,
} from "./app_accounts.js";

class ImBridgeApp {
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
    const { mkdir } = await import("node:fs/promises");
    await mkdir(this.config.uploadDir, { recursive: true });
    for (const account of await this.stateStore.listAccounts()) {
      if (!account.enabled) continue;
      await this.startAccountRuntime(account);
    }
    this.server = http.createServer((req, res) => {
      void handleHttpRequest(this.httpDeps, req, res);
    });
    await listen(this.server, this.config.port, this.config.host);
    await this.refreshStatusWatches();
    if (this.config.pollEnabled) {
      this.pollTimer = setInterval(() => {
        void _pollRoutes(this.inboundDeps).catch((error) => {
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

  private get httpDeps(): AppHttpDeps {
    return {
      config: this.config,
      stateStore: this.stateStore,
      accountRuntimes: this.accountRuntimes,
      logger: this.logger,
      requireUpload: (id) => this.requireUpload(id),
      requireRoute: (id) => this.requireRoute(id),
      requireAccount: (p, a) => this.requireAccount(p, a),
      requireAccountRuntime: (p, a) => this.requireAccountRuntime(p, a),
      getGatewayInfo: () => this.getGatewayInfo(),
    };
  }

  private get inboundDeps(): AppInboundDeps {
    return {
      config: this.config,
      stateStore: this.stateStore,
      accountRuntimes: this.accountRuntimes,
      ctx: this.ctx,
      logger: this.logger,
      requireSessionBinding: (id) => this.requireSessionBinding(id),
      refreshStatusWatches: () => this.refreshStatusWatches(),
      upsertRoute: (input) => this.upsertRoute(input),
    };
  }

  private get resourceDeps(): AppResourceDeps {
    return {
      config: this.config,
      stateStore: this.stateStore,
      accountRuntimes: this.accountRuntimes,
      logger: this.logger,
      requireRoute: (id) => this.requireRoute(id),
      requireUpload: (id) => this.requireUpload(id),
      requireAccountRuntime: (p, a) => this.requireAccountRuntime(p, a),
      requireRouteMessage: (route, id) => this.requireRouteMessage(route, id),
      refreshRouteMessages: (route, limit) => this.refreshRouteMessages(route, limit),
    };
  }

  private get accountDeps(): AppAccountDeps {
    return {
      config: this.config,
      stateStore: this.stateStore,
      accountRuntimes: this.accountRuntimes,
      logger: this.logger,
      requireAccount: (p, a) => this.requireAccount(p, a),
      requireAccountRuntime: (p, a) => this.requireAccountRuntime(p, a),
      requireSessionBinding: (id) => this.requireSessionBinding(id),
      upsertRoute: (input) => this.upsertRoute(input),
      refreshStatusWatches: () => this.refreshStatusWatches(),
      startAccountRuntime: (account) => this.startAccountRuntime(account),
      stopAccountRuntime: (p, a) => this.stopAccountRuntime(p, a),
      getProvider: (id) => this.registry.getProvider(id),
    };
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

  listProviders() { return this.registry.listProviders(); }
  async listAccounts() { return _listAccounts(this.accountDeps); }
  async upsertAccount(input: Parameters<typeof _upsertAccount>[1]) { return _upsertAccount(this.accountDeps, input); }
  async deleteAccount(providerID: string, accountID: string) { return _deleteAccount(this.accountDeps, providerID, accountID); }
  async listAccountChats(providerID: string, accountID: string, options?: { limit?: number; refresh?: boolean }) { return _listAccountChats(this.accountDeps, providerID, accountID, options); }
  async createAccountChat(input: Parameters<typeof _createAccountChat>[1]) { return _createAccountChat(this.accountDeps, input); }
  async deleteAccountChat(input: Parameters<typeof _deleteAccountChat>[1]) { return _deleteAccountChat(this.accountDeps, input); }
  async listAccountChatMembers(input: Parameters<typeof _listAccountChatMembers>[1]) { return _listAccountChatMembers(this.accountDeps, input); }
  async addAccountChatMembers(input: Parameters<typeof _addAccountChatMembers>[1]) { return _addAccountChatMembers(this.accountDeps, input); }

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
      runtimeID: string; instanceWorkspaceDirectory: string; content: string; displayID?: string; title?: string; model?: string;
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
      enabled: input.enabled ?? true, runtimeID, sessionID: created.sessionID, directory,
      displayID: input.displayID, title: input.title, model: input.model,
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

  async upsertRoute(input: { provider: string; accountID: string; chatID: string; chatName?: string; enabled?: boolean; sessionBindingID?: string }) {
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
      } catch { chatName = chatID; }
    }
    const now = new Date().toISOString();
    const route: GatewayRoute = { routeID, provider, accountID: account.accountID, chatID, chatName, enabled: input.enabled ?? previous?.enabled ?? true, sessionBindingID, createdAt: previous?.createdAt || now, updatedAt: now };
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

  async listRouteMessages(routeID: string, options?: { limit?: number; refresh?: boolean }) { return _listRouteMessages(this.resourceDeps, routeID, options); }
  async sendRouteTextMessage(routeID: string, text: string) { return _sendRouteTextMessage(this.resourceDeps, routeID, text); }
  async requestUpload(input: { type: "image" | "file"; routeID?: string }) { return _requestUpload(this.resourceDeps, input); }
  async sendRouteUpload(routeID: string, uploadID: string) { return _sendRouteUpload(this.resourceDeps, routeID, uploadID); }
  async requestDownload(input: { routeID: string; messageID: string; type: import("./types.js").GatewayResourceType }) { return _requestDownload(this.resourceDeps, input); }
  async listRecentRouteEvents(routeID: string, limit: number) { return _listRecentRouteEvents(this.resourceDeps, routeID, limit); }

  private async startAccountRuntime(account: GatewayAccount): Promise<void> {
    await this.stopAccountRuntime(account.provider, account.accountID);
    const provider = this.registry.getProvider(account.provider);
    const runtime = provider.createAccountRuntime({
      account, gatewayConfig: this.config,
      onInboundEvent: async (event) => { await _handleProviderInbound(this.inboundDeps, account, event); },
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

  private async refreshRouteMessages(route: GatewayRoute, limit: number): Promise<void> {
    const runtime = await this.requireAccountRuntime(route.provider, route.accountID);
    const messages = await runtime.listChatMessages(route.chatID, limit);
    const normalized = messages.map((item) => ({ ...item, routeID: route.routeID, provider: route.provider, accountID: route.accountID, chatID: route.chatID }));
    await this.stateStore.replaceRouteMessages(route.routeID, normalized, this.config.messageCacheLimit);
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
    const label = toStatusLabel({ runtimeStatus: event.current.runtimeStatus, sessionState: event.current.sessionState });
    if (!label) return;
    const routes = (await this.stateStore.listRoutes()).filter((route) => route.enabled && route.sessionBindingID === binding.sessionBindingID);
    for (const route of routes) {
      await applyRouteStatus(this.inboundDeps, route, label).catch((error) => {
        this.logger.warn("route status sync failed", { routeID: route.routeID, message: error instanceof Error ? error.message : String(error) });
      });
    }
  }
}

export { ImBridgeApp };
