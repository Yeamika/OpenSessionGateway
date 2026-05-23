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

export const EMPTY_STATE: GatewayState = {
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

export function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function asNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function normalizeAccount(value: unknown, fallbackAccountID = ""): GatewayAccount | null {
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

export function normalizeSessionBinding(value: unknown, fallbackID = ""): GatewaySessionBinding | null {
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

export function normalizeRoute(value: unknown, fallbackID = ""): GatewayRoute | null {
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

export function normalizeChat(value: unknown, fallbackRouteID = ""): GatewayChatSummary | null {
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

export function normalizeMessage(value: unknown, fallbackRouteID = ""): GatewayMessageSummary | null {
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

export function normalizeInboundEvent(value: unknown): GatewayInboundEvent | null {
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

export function normalizeUpload(value: unknown, fallbackID = ""): GatewayUpload | null {
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

export function normalizeAsset(value: unknown, fallbackID = ""): GatewayAsset | null {
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

export function normalizeRouteStatus(value: unknown, fallbackRouteID = ""): GatewayRouteStatus | null {
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

export function normalizeState(value: unknown): GatewayState {
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
