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

const EMPTY_STATE: GatewayState = {
  accounts: {},
  sessionBindings: {},
  routes: {},
  chatsByRoute: {},
  messagesByRoute: {},
  routeStatuses: {},
  uploads: {},
  assets: {},
  forwardedInboundKeys: [],
  recentInboundEventsByRoute: {},
  lastRouteSyncAt: null,
  lastEventAt: null,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeAccount(value: unknown, fallbackAccountID = ""): GatewayAccount | null {
  if (!isObject(value)) return null;
  const accountID = asString(value.accountID) || fallbackAccountID;
  const provider = asString(value.provider);
  if (!provider || !accountID) return null;
  const config = isObject(value.config) ? value.config : {};
  const now = new Date().toISOString();
  return {
    provider,
    accountID,
    displayName: asString(value.displayName),
    enabled: value.enabled === true,
    config,
    createdAt: asString(value.createdAt) || now,
    updatedAt: asString(value.updatedAt) || now,
  };
}

function normalizeSessionBinding(value: unknown, fallbackID = ""): GatewaySessionBinding | null {
  if (!isObject(value)) return null;
  const sessionBindingID = asString(value.sessionBindingID) || fallbackID;
  if (!sessionBindingID) return null;
  const now = new Date().toISOString();
  return {
    sessionBindingID,
    enabled: value.enabled === true,
    runtimeID: asString(value.runtimeID),
    sessionID: asString(value.sessionID),
    directory: asString(value.directory),
    displayID: asString(value.displayID),
    title: asString(value.title),
    model: asString(value.model),
    createdAt: asString(value.createdAt) || now,
    updatedAt: asString(value.updatedAt) || now,
  };
}

function normalizeRoute(value: unknown, fallbackID = ""): GatewayRoute | null {
  if (!isObject(value)) return null;
  const routeID = asString(value.routeID) || fallbackID;
  if (!routeID) return null;
  const provider = asString(value.provider);
  const accountID = asString(value.accountID);
  const chatID = asString(value.chatID);
  if (!provider || !accountID || !chatID) return null;
  const now = new Date().toISOString();
  return {
    routeID,
    provider,
    accountID,
    chatID,
    chatName: asString(value.chatName),
    enabled: value.enabled !== false,
    sessionBindingID: asString(value.sessionBindingID),
    createdAt: asString(value.createdAt) || now,
    updatedAt: asString(value.updatedAt) || now,
  };
}

function normalizeChat(value: unknown, fallbackRouteID = ""): GatewayChatSummary | null {
  if (!isObject(value)) return null;
  const routeID = asString(value.routeID) || fallbackRouteID;
  if (!routeID) return null;
  return {
    chatID: asString(value.chatID),
    name: asString(value.name),
    description: asString(value.description),
    avatar: asString(value.avatar),
    chatStatus: asString(value.chatStatus),
    chatType: asString(value.chatType),
    chatMode: asString(value.chatMode),
    ownerID: asString(value.ownerID),
    ownerIDType: asString(value.ownerIDType),
    tenantKey: asString(value.tenantKey),
    external: value.external === true,
    userCount: asNullableNumber(value.userCount),
    botCount: asNullableNumber(value.botCount),
    lastMessageTime: asString(value.lastMessageTime) || null,
    lastMessageType: asString(value.lastMessageType) || null,
    lastMessagePreview: asString(value.lastMessagePreview),
    detailError: asString(value.detailError),
    updatedAt: asString(value.updatedAt) || new Date().toISOString(),
  };
}

function normalizeMessage(value: unknown, fallbackRouteID = ""): GatewayMessageSummary | null {
  if (!isObject(value)) return null;
  const messageID = asString(value.messageID);
  const routeID = asString(value.routeID) || fallbackRouteID;
  if (!messageID || !routeID) return null;
  return {
    messageID,
    routeID,
    provider: asString(value.provider),
    accountID: asString(value.accountID),
    chatID: asString(value.chatID),
    msgType: asString(value.msgType),
    resourceType: asString(value.resourceType),
    resourceKey: asString(value.resourceKey),
    createTime: asString(value.createTime) || null,
    updateTime: asString(value.updateTime) || null,
    deleted: value.deleted === true,
    updated: value.updated === true,
    senderID: asString(value.senderID),
    senderType: asString(value.senderType),
    preview: asString(value.preview),
    content: typeof value.content === "string" ? value.content : "",
    updatedAt: asString(value.updatedAt) || new Date().toISOString(),
  };
}

function normalizeInboundEvent(value: unknown): GatewayInboundEvent | null {
  if (!isObject(value)) return null;
  const routeID = asString(value.routeID);
  const messageID = asString(value.messageID);
  if (!routeID || !messageID) return null;
  return {
    routeID,
    provider: asString(value.provider),
    accountID: asString(value.accountID),
    chatID: asString(value.chatID),
    chatName: asString(value.chatName),
    messageID,
    msgType: asString(value.msgType),
    resourceType: asString(value.resourceType),
    resourceKey: asString(value.resourceKey),
    senderID: asString(value.senderID),
    senderOpenID: asString(value.senderOpenID),
    senderType: asString(value.senderType),
    preview: asString(value.preview),
    content: typeof value.content === "string" ? value.content : "",
    createTime: asString(value.createTime) || null,
    receivedAt: asString(value.receivedAt) || new Date().toISOString(),
    updatedAt: asString(value.updatedAt) || new Date().toISOString(),
  };
}

function normalizeUpload(value: unknown, fallbackID = ""): GatewayUpload | null {
  if (!isObject(value)) return null;
  const uploadID = asString(value.uploadID) || fallbackID;
  if (!uploadID) return null;
  const type = asString(value.type);
  if (type !== "image" && type !== "file") return null;
  const providerRefs = isObject(value.providerRefs)
    ? Object.fromEntries(
      Object.entries(value.providerRefs)
        .map(([key, item]) => {
          const row = isObject(item) ? item : {};
          return [key, {
            provider: asString(row.provider),
            accountID: asString(row.accountID),
            resourceType: (asString(row.resourceType) === "image" ? "image" : "file") as "image" | "file",
            resourceKey: asString(row.resourceKey),
            uploadedAt: asString(row.uploadedAt) || new Date().toISOString(),
          }];
        }),
    )
    : {};
  return {
    uploadID,
    routeID: asString(value.routeID),
    type,
    fileName: asString(value.fileName),
    mimeType: asString(value.mimeType),
    localPath: asString(value.localPath),
    byteLength: asNullableNumber(value.byteLength) || 0,
    status: asString(value.status) === "ready" ? "ready" : "pending",
    providerRefs,
    createdAt: asString(value.createdAt) || new Date().toISOString(),
    updatedAt: asString(value.updatedAt) || new Date().toISOString(),
  };
}

function normalizeAsset(value: unknown, fallbackID = ""): GatewayAsset | null {
  if (!isObject(value)) return null;
  const assetID = asString(value.assetID) || fallbackID;
  const type = asString(value.type);
  if (!assetID || !type) return null;
  return {
    assetID,
    routeID: asString(value.routeID),
    provider: asString(value.provider),
    accountID: asString(value.accountID),
    chatID: asString(value.chatID),
    messageID: asString(value.messageID),
    type: type as GatewayAsset["type"],
    resourceKey: asString(value.resourceKey),
    createdAt: asString(value.createdAt) || new Date().toISOString(),
  };
}

function normalizeRouteStatus(value: unknown, fallbackRouteID = ""): GatewayRouteStatus | null {
  if (!isObject(value)) return null;
  const routeID = asString(value.routeID) || fallbackRouteID;
  const label = asString(value.label);
  if (!routeID || (label !== "idle" && label !== "busy" && label !== "error" && label !== "offline" && label !== "missing_session")) return null;
  return {
    routeID,
    label,
    targetMessageID: asString(value.targetMessageID),
    reactionID: asString(value.reactionID),
    reactionEmojiType: asString(value.reactionEmojiType),
    detail: asString(value.detail),
    updatedAt: asString(value.updatedAt) || new Date().toISOString(),
  };
}

function normalizeState(value: unknown): GatewayState {
  const parsed = isObject(value) ? value : {};
  const recentInboundEventsByRoute = Object.fromEntries(
    Object.entries(isObject(parsed.recentInboundEventsByRoute) ? parsed.recentInboundEventsByRoute : {}).map(([routeID, rows]) => [
      routeID,
      Array.isArray(rows) ? rows.map(normalizeInboundEvent).filter((item): item is GatewayInboundEvent => Boolean(item)) : [],
    ]),
  );
  const messagesByRoute = Object.fromEntries(
    Object.entries(isObject(parsed.messagesByRoute) ? parsed.messagesByRoute : {}).map(([routeID, rows]) => [
      routeID,
      Array.isArray(rows) ? rows.map((row) => normalizeMessage({ ...(isObject(row) ? row : {}), routeID })).filter((item): item is GatewayMessageSummary => Boolean(item)) : [],
    ]),
  );

  return {
    accounts: Object.fromEntries(
      Object.entries(isObject(parsed.accounts) ? parsed.accounts : {})
        .map(([fallbackKey, item]) => normalizeAccount(item, fallbackKey))
        .filter((item): item is GatewayAccount => Boolean(item))
        .map((item) => [accountKeyOf(item.provider, item.accountID), item]),
    ),
    sessionBindings: Object.fromEntries(
      Object.entries(isObject(parsed.sessionBindings) ? parsed.sessionBindings : {})
        .map(([fallbackKey, item]) => normalizeSessionBinding(item, fallbackKey))
        .filter((item): item is GatewaySessionBinding => Boolean(item))
        .map((item) => [item.sessionBindingID, item]),
    ),
    routes: Object.fromEntries(
      Object.entries(isObject(parsed.routes) ? parsed.routes : {})
        .map(([fallbackKey, item]) => normalizeRoute(item, fallbackKey))
        .filter((item): item is GatewayRoute => Boolean(item))
        .map((item) => [item.routeID, item]),
    ),
    chatsByRoute: Object.fromEntries(
      Object.entries(isObject(parsed.chatsByRoute) ? parsed.chatsByRoute : {})
        .map(([routeID, item]) => [routeID, normalizeChat({ ...(isObject(item) ? item : {}), routeID }, routeID)] as const)
        .filter((entry): entry is readonly [string, GatewayChatSummary] => Boolean(entry[1])),
    ),
    messagesByRoute,
    routeStatuses: Object.fromEntries(
      Object.entries(isObject(parsed.routeStatuses) ? parsed.routeStatuses : {})
        .map(([routeID, item]) => [routeID, normalizeRouteStatus({ ...(isObject(item) ? item : {}), routeID }, routeID)] as const)
        .filter((entry): entry is readonly [string, GatewayRouteStatus] => Boolean(entry[1])),
    ),
    uploads: Object.fromEntries(
      Object.entries(isObject(parsed.uploads) ? parsed.uploads : {})
        .map(([fallbackKey, item]) => normalizeUpload(item, fallbackKey))
        .filter((item): item is GatewayUpload => Boolean(item))
        .map((item) => [item.uploadID, item]),
    ),
    assets: Object.fromEntries(
      Object.entries(isObject(parsed.assets) ? parsed.assets : {})
        .map(([fallbackKey, item]) => normalizeAsset(item, fallbackKey))
        .filter((item): item is GatewayAsset => Boolean(item))
        .map((item) => [item.assetID, item]),
    ),
    forwardedInboundKeys: Array.isArray(parsed.forwardedInboundKeys)
      ? parsed.forwardedInboundKeys.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [],
    recentInboundEventsByRoute,
    lastRouteSyncAt: asString(parsed.lastRouteSyncAt) || null,
    lastEventAt: asString(parsed.lastEventAt) || null,
  };
}

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
