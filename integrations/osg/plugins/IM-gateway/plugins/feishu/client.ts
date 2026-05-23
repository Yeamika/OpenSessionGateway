import * as lark from "@larksuiteoapi/node-sdk";
import type { Readable } from "node:stream";

import type { GatewayProviderInboundEvent, GatewayReactionResult } from "../../src/provider.js";
import type { GatewayChatSummary, GatewayMessageSummary, GatewayResourceType, GatewaySendMessageResult, GatewayUserIDType } from "../../src/types.js";

import {
  type FeishuGatewayAccountConfig,
  asString,
  clamp,
  defaultUserIDType,
  detectFileType,
  loggerLevel,
  normalizeChat,
  normalizeChatMember,
  normalizeInboundEvent,
  normalizeMemberIDType,
  normalizeMessage,
  normalizeUserIDType,
  uniqueStrings,
} from "./feishu_helpers.js";

export type { FeishuGatewayAccountConfig };

type FeishuInboundTransport = "webhook" | "websocket";

export class FeishuGatewayClient {
  readonly client: lark.Client;
  private readonly providerID: string;
  private readonly accountID: string;
  private readonly config: FeishuGatewayAccountConfig;
  private readonly onInboundEvent: (event: GatewayProviderInboundEvent) => Promise<void>;
  private readonly webhookDispatcher: lark.EventDispatcher;
  private readonly wsDispatcher: lark.EventDispatcher | null;
  private readonly wsClient: lark.WSClient | null;
  private wsStarted = false;
  private lastInboundTransport: FeishuInboundTransport | "" = "";
  private lastInboundAt: string | null = null;
  private lastWsStartError = "";

  constructor(
    providerID: string,
    accountID: string,
    config: FeishuGatewayAccountConfig,
    onInboundEvent: (event: GatewayProviderInboundEvent) => Promise<void>,
  ) {
    this.providerID = providerID;
    this.accountID = accountID;
    this.config = config;
    this.onInboundEvent = onInboundEvent;
    this.client = new lark.Client({
      appId: config.appId,
      appSecret: config.appSecret,
      appType: lark.AppType.SelfBuild,
      domain: lark.Domain.Feishu,
      loggerLevel: loggerLevel(config.logLevel),
    });
    this.webhookDispatcher = this.createDispatcher("webhook");
    this.wsDispatcher = config.wsEnabled ? this.createDispatcher("websocket") : null;
    this.wsClient = config.wsEnabled
      ? new lark.WSClient({
        appId: config.appId,
        appSecret: config.appSecret,
        domain: lark.Domain.Feishu,
        loggerLevel: loggerLevel(config.logLevel),
        autoReconnect: config.wsAutoReconnect,
      })
      : null;
  }

  private createDispatcher(transport: FeishuInboundTransport): lark.EventDispatcher {
    return new lark.EventDispatcher({
      verificationToken: this.config.verificationToken || undefined,
      encryptKey: this.config.encryptKey || undefined,
      loggerLevel: loggerLevel(this.config.logLevel),
    }).register({
      "im.message.receive_v1": async (data: Record<string, unknown>) => {
        const event = normalizeInboundEvent(data);
        if (!event) return;
        this.lastInboundTransport = transport;
        this.lastInboundAt = event.receivedAt;
        void this.onInboundEvent(event).catch((error) => {
          console.warn("[im-gateway][feishu] inbound event failed", {
            provider: this.providerID,
            accountID: this.accountID,
            transport,
            message: error instanceof Error ? error.message : String(error),
          });
        });
      },
    });
  }

  async start(): Promise<void> {
    if (!this.wsClient || !this.wsDispatcher || this.wsStarted) return;
    try {
      await this.wsClient.start({ eventDispatcher: this.wsDispatcher });
      this.wsStarted = true;
      this.lastWsStartError = "";
    } catch (error) {
      this.lastWsStartError = error instanceof Error ? error.message : String(error);
    }
  }

  async stop(): Promise<void> {
    if (!this.wsClient) return;
    this.wsClient.close({ force: true });
    this.wsStarted = false;
  }

  getRuntimeInfo() {
    return {
      webhookEnabled: true,
      websocketEnabled: Boolean(this.wsClient),
      websocketStarted: this.wsStarted,
      websocketAutoReconnect: this.config.wsAutoReconnect,
      lastInboundTransport: this.lastInboundTransport || null,
      lastInboundAt: this.lastInboundAt,
      websocketReconnect: this.wsClient ? this.wsClient.getReconnectInfo() : null,
      websocketStartError: this.lastWsStartError || null,
    };
  }

  createWebhookHandler(webhookPath: string) {
    return lark.adaptDefault(webhookPath, this.webhookDispatcher, { autoChallenge: true });
  }

  async listChats(limit: number): Promise<GatewayChatSummary[]> {
    const response = await this.client.im.v1.chat.list({ params: { page_size: clamp(limit, 1, 50) } });
    const rows = Array.isArray(response.data?.items) ? response.data.items : [];
    const list: GatewayChatSummary[] = [];
    for (const row of rows) {
      const summary = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
      const chatID = asString(summary.chat_id);
      if (!chatID) continue;
      try {
        list.push(await this.getChat(chatID));
      } catch (error) {
        list.push(normalizeChat(summary, error instanceof Error ? error.message : String(error), chatID));
      }
    }
    return list;
  }

  async getChat(chatID: string): Promise<GatewayChatSummary> {
    const response = await this.client.im.v1.chat.get({ path: { chat_id: chatID } });
    return normalizeChat((response.data || {}) as Record<string, unknown>, "", chatID);
  }

  async createChat(input: {
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
  }): Promise<GatewayChatSummary> {
    const response = await this.client.im.v1.chat.create({
      params: {
        user_id_type: normalizeUserIDType(input.userIDType, defaultUserIDType(this.config)),
        set_bot_manager: typeof input.setBotManager === "boolean" ? input.setBotManager : undefined,
        uuid: asString(input.uuid) || undefined,
      },
      data: {
        name: input.name.trim(),
        description: asString(input.description) || undefined,
        owner_id: asString(input.ownerID) || undefined,
        user_id_list: uniqueStrings(input.userIDs),
        bot_id_list: uniqueStrings(input.botIDs),
        external: input.external === true ? true : undefined,
        chat_mode: asString(input.chatMode) || undefined,
        chat_type: asString(input.chatType) || undefined,
      },
    });
    const chatID = asString(response.data?.chat_id);
    if (!chatID) throw new Error(`Feishu chat create failed for ${this.accountID}`);
    try {
      return await this.getChat(chatID);
    } catch {
      return normalizeChat((response.data || {}) as Record<string, unknown>, "", chatID);
    }
  }

  async deleteChat(chatID: string): Promise<void> {
    await this.client.im.v1.chat.delete({ path: { chat_id: chatID } });
  }

  async listChatMembers(chatID: string, options?: { memberIDType?: GatewayUserIDType; limit?: number }): Promise<{
    chatID: string;
    total: number | null;
    items: import("../../src/types.js").GatewayChatMember[];
  }> {
    const limit = clamp(Math.floor(options?.limit || 100), 1, 500);
    const memberIDType = normalizeUserIDType(options?.memberIDType, defaultUserIDType(this.config));
    const items: import("../../src/types.js").GatewayChatMember[] = [];
    let total: number | null = null;
    let pageToken: string | undefined;
    while (items.length < limit) {
      const response = await this.client.im.v1.chatMembers.get({
        path: { chat_id: chatID },
        params: {
          member_id_type: memberIDType,
          page_size: Math.min(100, limit - items.length),
          page_token: pageToken,
        },
      });
      const data = response.data || {};
      const rows = Array.isArray(data.items) ? data.items : [];
      if (total === null) total = (data as Record<string, unknown>).member_total as number | null;
      for (const row of rows) {
        const item = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
        items.push(normalizeChatMember(item));
        if (items.length >= limit) break;
      }
      if (data.has_more !== true) break;
      pageToken = asString((data as Record<string, unknown>).page_token) || undefined;
      if (!pageToken) break;
    }
    return { chatID, total, items };
  }

  async addChatMembers(chatID: string, input: {
    memberIDs: string[];
    memberIDType?: import("../../src/types.js").GatewayMemberIDType;
    succeedType?: number;
  }): Promise<{
    invalidIDs: string[];
    notExistedIDs: string[];
    pendingApprovalIDs: string[];
  }> {
    const response = await this.client.im.v1.chatMembers.create({
      path: { chat_id: chatID },
      params: {
        member_id_type: normalizeMemberIDType(input.memberIDType, defaultUserIDType(this.config)),
        succeed_type: typeof input.succeedType === "number" ? Math.max(0, Math.floor(input.succeedType)) : undefined,
      },
      data: {
        id_list: uniqueStrings(input.memberIDs),
      },
    });
    return {
      invalidIDs: uniqueStrings(response.data?.invalid_id_list),
      notExistedIDs: uniqueStrings(response.data?.not_existed_id_list),
      pendingApprovalIDs: uniqueStrings(response.data?.pending_approval_id_list),
    };
  }

  async listChatMessages(chatID: string, limit: number): Promise<GatewayMessageSummary[]> {
    const response = await this.client.im.v1.message.list({
      params: {
        container_id_type: "chat",
        container_id: chatID,
        page_size: clamp(limit, 1, 50),
        sort_type: "ByCreateTimeDesc",
      },
    });
    const rows = Array.isArray(response.data?.items) ? response.data.items : [];
    return rows.map((row) => normalizeMessage((row || {}) as Record<string, unknown>, this.providerID, this.accountID));
  }

  async downloadResource(messageID: string, resourceKey: string, resourceType: GatewayResourceType): Promise<{ stream: Readable; contentType?: string; fileName?: string }> {
    const response = await this.client.im.v1.messageResource.get({
      params: { type: resourceType },
      path: { message_id: messageID, file_key: resourceKey },
    });
    const headers = (response.headers || {}) as Record<string, unknown>;
    const contentType = typeof headers["content-type"] === "string" ? headers["content-type"] : undefined;
    const disposition = typeof headers["content-disposition"] === "string" ? headers["content-disposition"] : "";
    const fileNameMatch = disposition.match(/filename="?([^";]+)"?/i);
    return {
      stream: response.getReadableStream(),
      contentType,
      fileName: fileNameMatch?.[1],
    };
  }

  async sendTextMessage(chatID: string, text: string): Promise<GatewaySendMessageResult> {
    const response = await this.client.im.v1.message.create({
      params: { receive_id_type: "chat_id" },
      data: { receive_id: chatID, msg_type: "text", content: JSON.stringify({ text }) },
    });
    return { chatID, messageID: asString(response.data?.message_id), msgType: "text", sentAt: new Date().toISOString() };
  }

  async sendImageMessage(chatID: string, imageKey: string): Promise<GatewaySendMessageResult> {
    const response = await this.client.im.v1.message.create({
      params: { receive_id_type: "chat_id" },
      data: { receive_id: chatID, msg_type: "image", content: JSON.stringify({ image_key: imageKey }) },
    });
    return { chatID, messageID: asString(response.data?.message_id), msgType: "image", sentAt: new Date().toISOString() };
  }

  async sendFileMessage(chatID: string, fileKey: string): Promise<GatewaySendMessageResult> {
    const response = await this.client.im.v1.message.create({
      params: { receive_id_type: "chat_id" },
      data: { receive_id: chatID, msg_type: "file", content: JSON.stringify({ file_key: fileKey }) },
    });
    return { chatID, messageID: asString(response.data?.message_id), msgType: "file", sentAt: new Date().toISOString() };
  }

  async uploadImage(fileName: string, content: Buffer): Promise<string> {
    const response = await this.client.im.v1.image.create({ data: { image_type: "message", image: content } });
    const result = response as { data?: { image_key?: string }; image_key?: string } | null;
    const imageKey = asString(result?.data?.image_key) || asString(result?.image_key);
    if (!imageKey) throw new Error(`Feishu image upload failed for ${fileName}`);
    return imageKey;
  }

  async uploadFile(fileName: string, content: Buffer, mimeType?: string): Promise<string> {
    const response = await this.client.im.v1.file.create({
      data: {
        file_name: fileName,
        file_type: detectFileType(fileName, mimeType),
        file: content,
      },
    });
    const result = response as { file_key?: string } | null;
    const fileKey = asString(result?.file_key);
    if (!fileKey) throw new Error(`Feishu file upload failed for ${fileName}`);
    return fileKey;
  }

  async addMessageReaction(messageID: string, emojiType: string): Promise<GatewayReactionResult> {
    const response = await this.client.im.v1.messageReaction.create({
      path: { message_id: messageID },
      data: { reaction_type: { emoji_type: emojiType } },
    });
    const reactionID = asString(response.data?.reaction_id);
    if (!reactionID) throw new Error(`Feishu reaction create failed for ${messageID}`);
    return {
      messageID,
      reactionID,
      emojiType: asString(response.data?.reaction_type?.emoji_type) || emojiType,
      reactedAt: (await import("./feishu_helpers.js")).asString(response.data?.action_time) || new Date().toISOString(),
    };
  }

  async removeMessageReaction(messageID: string, reactionID: string): Promise<void> {
    await this.client.im.v1.messageReaction.delete({
      path: { message_id: messageID, reaction_id: reactionID },
    });
  }
}
