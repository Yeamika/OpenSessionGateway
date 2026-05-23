import type { IncomingMessage, ServerResponse } from "node:http";
import type { Readable } from "node:stream";

import type { ImBridgeConfig } from "./config.js";
import type {
  GatewayAccount,
  GatewayChatMember,
  GatewayChatSummary,
  GatewayMemberIDType,
  GatewayMessageSummary,
  GatewayResourceType,
  GatewaySendMessageResult,
  GatewayUserIDType,
} from "./types.js";
import { createFeishuGatewayProvider } from "../plugins/feishu/index.js";
import { createLocalGatewayProvider } from "../plugins/local/index.js";

export type GatewayProviderInboundEvent = {
  messageID: string;
  chatID: string;
  chatName: string;
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

export type GatewayReactionResult = {
  messageID: string;
  reactionID: string;
  emojiType: string;
  reactedAt: string;
};

export type GatewayProviderAccountRuntime = {
  start?: () => Promise<void>;
  stop?: () => Promise<void>;
  getRuntimeInfo?: () => Promise<Record<string, unknown> | null> | Record<string, unknown> | null;
  createWebhookHandler?: (webhookPath: string) => ((req: IncomingMessage, res: ServerResponse) => Promise<void>) | null;
  listChats: (limit: number) => Promise<GatewayChatSummary[]>;
  getChat: (chatID: string) => Promise<GatewayChatSummary>;
  createChat?: (input: {
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
  }) => Promise<GatewayChatSummary>;
  deleteChat?: (chatID: string) => Promise<void>;
  listChatMembers?: (chatID: string, options?: {
    memberIDType?: GatewayUserIDType;
    limit?: number;
  }) => Promise<{
    chatID: string;
    total: number | null;
    items: GatewayChatMember[];
  }>;
  addChatMembers?: (chatID: string, input: {
    memberIDs: string[];
    memberIDType?: GatewayMemberIDType;
    succeedType?: number;
  }) => Promise<{
    invalidIDs: string[];
    notExistedIDs: string[];
    pendingApprovalIDs: string[];
  }>;
  listChatMessages: (chatID: string, limit: number) => Promise<GatewayMessageSummary[]>;
  downloadResource: (messageID: string, resourceKey: string, resourceType: GatewayResourceType) => Promise<{
    stream: Readable;
    contentType?: string;
    fileName?: string;
  }>;
  sendTextMessage: (chatID: string, text: string) => Promise<GatewaySendMessageResult>;
  sendImageMessage: (chatID: string, imageKey: string) => Promise<GatewaySendMessageResult>;
  sendFileMessage: (chatID: string, fileKey: string) => Promise<GatewaySendMessageResult>;
  uploadImage: (fileName: string, content: Buffer, mimeType?: string) => Promise<string>;
  uploadFile: (fileName: string, content: Buffer, mimeType?: string) => Promise<string>;
  addMessageReaction?: (messageID: string, emojiType: string) => Promise<GatewayReactionResult>;
  removeMessageReaction?: (messageID: string, reactionID: string) => Promise<void>;
};

export type GatewayProviderPlugin = {
  id: string;
  displayName: string;
  normalizeAccountConfig?: (config: Record<string, unknown>) => Record<string, unknown>;
  createAccountRuntime: (input: {
    account: GatewayAccount;
    gatewayConfig: ImBridgeConfig;
    onInboundEvent: (event: GatewayProviderInboundEvent) => Promise<void>;
  }) => GatewayProviderAccountRuntime;
};

const BUILTIN_PROVIDERS: GatewayProviderPlugin[] = [
  createLocalGatewayProvider(),
  createFeishuGatewayProvider(),
];

export class GatewayProviderRegistry {
  private readonly providers = new Map<string, GatewayProviderPlugin>();

  constructor() {
    for (const provider of BUILTIN_PROVIDERS) {
      this.providers.set(provider.id, provider);
    }
  }

  listProviders() {
    return [...this.providers.values()].map((item) => ({
      id: item.id,
      displayName: item.displayName,
    }));
  }

  getProvider(providerID: string): GatewayProviderPlugin {
    const clean = providerID.trim().toLowerCase();
    const provider = this.providers.get(clean);
    if (!provider) {
      throw new Error(`Unsupported IM gateway provider: ${providerID}`);
    }
    return provider;
  }
}
