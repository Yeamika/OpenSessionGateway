export type GatewayResourceType = "image" | "file" | "audio" | "media";

export type GatewayUserIDType = "user_id" | "union_id" | "open_id";

export type GatewayMemberIDType = GatewayUserIDType | "app_id";

export type GatewayAccount = {
  provider: string;
  accountID: string;
  displayName: string;
  enabled: boolean;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type GatewaySessionBinding = {
  sessionBindingID: string;
  enabled: boolean;
  runtimeID: string;
  sessionID: string;
  directory: string;
  displayID: string;
  title: string;
  model: string;
  createdAt: string;
  updatedAt: string;
};

export type GatewayRoute = {
  routeID: string;
  provider: string;
  accountID: string;
  chatID: string;
  chatName: string;
  enabled: boolean;
  sessionBindingID: string;
  createdAt: string;
  updatedAt: string;
};

export type GatewayRouteStatus = {
  routeID: string;
  label: "idle" | "busy" | "error";
  targetMessageID: string;
  reactionID: string;
  reactionEmojiType: string;
  updatedAt: string;
};

export type GatewayMessageSummary = {
  messageID: string;
  routeID: string;
  provider: string;
  accountID: string;
  chatID: string;
  msgType: string;
  resourceType: string;
  resourceKey: string;
  createTime: string | null;
  updateTime: string | null;
  deleted: boolean;
  updated: boolean;
  senderID: string;
  senderType: string;
  preview: string;
  content: string;
  updatedAt: string;
};

export type GatewayInboundEvent = {
  routeID: string;
  provider: string;
  accountID: string;
  chatID: string;
  chatName: string;
  messageID: string;
  msgType: string;
  resourceType: string;
  resourceKey: string;
  senderID: string;
  senderOpenID: string;
  senderType: string;
  preview: string;
  content: string;
  createTime: string | null;
  receivedAt: string;
  updatedAt: string;
};

export type GatewayUpload = {
  uploadID: string;
  routeID: string;
  type: "image" | "file";
  fileName: string;
  mimeType: string;
  localPath: string;
  byteLength: number;
  status: "pending" | "ready";
  providerRefs: Record<string, {
    provider: string;
    accountID: string;
    resourceType: "image" | "file";
    resourceKey: string;
    uploadedAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
};

export type GatewayAsset = {
  assetID: string;
  routeID: string;
  provider: string;
  accountID: string;
  chatID: string;
  messageID: string;
  type: GatewayResourceType;
  resourceKey: string;
  createdAt: string;
};

export type GatewayChatSummary = {
  chatID: string;
  name: string;
  description: string;
  avatar: string;
  chatStatus: string;
  chatType: string;
  chatMode: string;
  ownerID: string;
  ownerIDType: string;
  tenantKey: string;
  external: boolean;
  userCount: number | null;
  botCount: number | null;
  lastMessageTime: string | null;
  lastMessageType: string | null;
  lastMessagePreview: string;
  detailError: string;
  updatedAt: string;
};

export type GatewayChatMember = {
  memberIDType: string;
  memberID: string;
  name: string;
  tenantKey: string;
};

export type GatewaySendMessageResult = {
  chatID: string;
  messageID: string;
  msgType: string;
  sentAt: string;
};

export type GatewayState = {
  accounts: Record<string, GatewayAccount>;
  sessionBindings: Record<string, GatewaySessionBinding>;
  routes: Record<string, GatewayRoute>;
  chatsByRoute: Record<string, GatewayChatSummary>;
  messagesByRoute: Record<string, GatewayMessageSummary[]>;
  routeStatuses: Record<string, GatewayRouteStatus>;
  uploads: Record<string, GatewayUpload>;
  assets: Record<string, GatewayAsset>;
  forwardedInboundKeys: string[];
  recentInboundEventsByRoute: Record<string, GatewayInboundEvent[]>;
  lastRouteSyncAt: string | null;
  lastEventAt: string | null;
};

export function accountKeyOf(provider: string, accountID: string): string {
  return `${provider.trim().toLowerCase()}::${encodeURIComponent(accountID.trim())}`;
}

export function routeIDOf(provider: string, accountID: string, chatID: string): string {
  return `${provider.trim().toLowerCase()}::${encodeURIComponent(accountID.trim())}::${encodeURIComponent(chatID.trim())}`;
}

export function routeUploadKey(routeID: string, uploadID: string): string {
  return `${routeID}::${uploadID}`;
}
