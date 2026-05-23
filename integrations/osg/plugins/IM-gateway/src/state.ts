import fs from "node:fs/promises";
import path from "node:path";

import type {
  GatewayAccount,
  GatewayAsset,
  GatewayChatSummary,
  GatewayInboundEvent,
  GatewayMessageSummary,
  GatewayRoute,
  GatewayRouteStatus,
  GatewaySessionBinding,
  GatewayState,
  GatewayUpload,
} from "./types.js";
import { accountKeyOf } from "./types.js";

import { EMPTY_STATE, normalizeState } from "./state_normalize.js";

export class StateStore {
  private gate = Promise.resolve();
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private async queue<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.gate;
    let release!: () => void;
    this.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async update<T>(mutator: (state: GatewayState) => Promise<T> | T): Promise<T> {
    return this.queue(async () => {
      const state = await this.load();
      const result = await mutator(state);
      await this.save(state);
      return result;
    });
  }

  async load(): Promise<GatewayState> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return normalizeState(JSON.parse(raw));
    } catch {
      return structuredClone(EMPTY_STATE);
    }
  }

  async save(state: GatewayState): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  async ensure(): Promise<void> {
    await this.update(async () => undefined);
  }

  async upsertAccount(account: GatewayAccount): Promise<GatewayAccount> {
    return this.update(async (state) => {
      state.accounts[accountKeyOf(account.provider, account.accountID)] = structuredClone(account);
      return structuredClone(account);
    });
  }

  async removeAccount(provider: string, accountID: string): Promise<void> {
    await this.update(async (state) => {
      delete state.accounts[accountKeyOf(provider, accountID)];
    });
  }

  async getAccount(provider: string, accountID: string): Promise<GatewayAccount | null> {
    const state = await this.load();
    const key = accountKeyOf(provider, accountID);
    return state.accounts[key] ? structuredClone(state.accounts[key]) : null;
  }

  async listAccounts(): Promise<GatewayAccount[]> {
    const state = await this.load();
    return Object.values(state.accounts).map((item) => structuredClone(item));
  }

  async upsertSessionBinding(binding: GatewaySessionBinding): Promise<GatewaySessionBinding> {
    return this.update(async (state) => {
      state.sessionBindings[binding.sessionBindingID] = structuredClone(binding);
      return structuredClone(binding);
    });
  }

  async removeSessionBinding(sessionBindingID: string): Promise<void> {
    await this.update(async (state) => {
      delete state.sessionBindings[sessionBindingID];
    });
  }

  async getSessionBinding(sessionBindingID: string): Promise<GatewaySessionBinding | null> {
    const state = await this.load();
    return state.sessionBindings[sessionBindingID] ? structuredClone(state.sessionBindings[sessionBindingID]) : null;
  }

  async listSessionBindings(): Promise<GatewaySessionBinding[]> {
    const state = await this.load();
    return Object.values(state.sessionBindings).map((item) => structuredClone(item));
  }

  async upsertRoute(route: GatewayRoute): Promise<GatewayRoute> {
    return this.update(async (state) => {
      state.routes[route.routeID] = structuredClone(route);
      state.lastRouteSyncAt = new Date().toISOString();
      return structuredClone(route);
    });
  }

  async removeRoute(routeID: string): Promise<void> {
    await this.update(async (state) => {
      delete state.routes[routeID];
      delete state.chatsByRoute[routeID];
      delete state.messagesByRoute[routeID];
      delete state.routeStatuses[routeID];
      delete state.recentInboundEventsByRoute[routeID];
    });
  }

  async getRoute(routeID: string): Promise<GatewayRoute | null> {
    const state = await this.load();
    return state.routes[routeID] ? structuredClone(state.routes[routeID]) : null;
  }

  async listRoutes(): Promise<GatewayRoute[]> {
    const state = await this.load();
    return Object.values(state.routes).map((item) => structuredClone(item));
  }

  async saveChat(routeID: string, chat: GatewayChatSummary): Promise<GatewayChatSummary> {
    return this.update(async (state) => {
      state.chatsByRoute[routeID] = structuredClone(chat);
      return structuredClone(chat);
    });
  }

  async getChat(routeID: string): Promise<GatewayChatSummary | null> {
    const state = await this.load();
    return state.chatsByRoute[routeID] ? structuredClone(state.chatsByRoute[routeID]) : null;
  }

  async replaceRouteMessages(routeID: string, messages: GatewayMessageSummary[], cacheLimit: number): Promise<GatewayMessageSummary[]> {
    return this.update(async (state) => {
      state.messagesByRoute[routeID] = messages.slice(0, cacheLimit).map((item) => structuredClone(item));
      return state.messagesByRoute[routeID].map((item) => structuredClone(item));
    });
  }

  async getRouteMessages(routeID: string): Promise<GatewayMessageSummary[]> {
    const state = await this.load();
    return (state.messagesByRoute[routeID] || []).map((item) => structuredClone(item));
  }

  async saveRouteStatus(status: GatewayRouteStatus | null): Promise<GatewayRouteStatus | null> {
    return this.update(async (state) => {
      if (!status) return null;
      state.routeStatuses[status.routeID] = structuredClone(status);
      return structuredClone(status);
    });
  }

  async clearRouteStatus(routeID: string): Promise<void> {
    await this.update(async (state) => {
      delete state.routeStatuses[routeID];
    });
  }

  async getRouteStatus(routeID: string): Promise<GatewayRouteStatus | null> {
    const state = await this.load();
    return state.routeStatuses[routeID] ? structuredClone(state.routeStatuses[routeID]) : null;
  }

  async saveUpload(upload: GatewayUpload, limit: number): Promise<GatewayUpload> {
    return this.update(async (state) => {
      state.uploads[upload.uploadID] = structuredClone(upload);
      const ordered = Object.values(state.uploads)
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .slice(0, limit);
      state.uploads = Object.fromEntries(ordered.map((item) => [item.uploadID, item]));
      return structuredClone(upload);
    });
  }

  async getUpload(uploadID: string): Promise<GatewayUpload | null> {
    const state = await this.load();
    return state.uploads[uploadID] ? structuredClone(state.uploads[uploadID]) : null;
  }

  async saveAsset(asset: GatewayAsset, limit: number): Promise<GatewayAsset> {
    return this.update(async (state) => {
      state.assets[asset.assetID] = structuredClone(asset);
      const ordered = Object.values(state.assets)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, limit);
      state.assets = Object.fromEntries(ordered.map((item) => [item.assetID, item]));
      return structuredClone(asset);
    });
  }

  async getAsset(assetID: string): Promise<GatewayAsset | null> {
    const state = await this.load();
    return state.assets[assetID] ? structuredClone(state.assets[assetID]) : null;
  }

  async hasForwardedInbound(forwardKey: string): Promise<boolean> {
    const state = await this.load();
    return state.forwardedInboundKeys.includes(forwardKey);
  }

  async markForwardedInbound(forwardKey: string, limit: number): Promise<void> {
    await this.update(async (state) => {
      state.forwardedInboundKeys = [forwardKey, ...state.forwardedInboundKeys.filter((item) => item !== forwardKey)].slice(0, limit);
    });
  }

  async appendInboundEvent(event: GatewayInboundEvent, eventLimit: number, messageCacheLimit: number): Promise<void> {
    await this.update(async (state) => {
      state.recentInboundEventsByRoute[event.routeID] = [
        event,
        ...(state.recentInboundEventsByRoute[event.routeID] || []).filter((item) => item.messageID !== event.messageID),
      ].slice(0, eventLimit);
      const message: GatewayMessageSummary = {
        messageID: event.messageID,
        routeID: event.routeID,
        provider: event.provider,
        accountID: event.accountID,
        chatID: event.chatID,
        msgType: event.msgType,
        resourceType: event.resourceType,
        resourceKey: event.resourceKey,
        createTime: event.createTime,
        updateTime: event.updatedAt,
        deleted: false,
        updated: false,
        senderID: event.senderID,
        senderType: event.senderType,
        preview: event.preview,
        content: event.content,
        updatedAt: event.updatedAt,
      };
      state.messagesByRoute[event.routeID] = [
        message,
        ...(state.messagesByRoute[event.routeID] || []).filter((item) => item.messageID !== event.messageID),
      ].slice(0, messageCacheLimit);
      state.lastEventAt = event.receivedAt;
    });
  }

  async listRecentInboundEvents(routeID: string, limit: number): Promise<GatewayInboundEvent[]> {
    const state = await this.load();
    return (state.recentInboundEventsByRoute[routeID] || []).slice(0, limit).map((item) => structuredClone(item));
  }
}
