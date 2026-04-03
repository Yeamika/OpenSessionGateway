import * as lark from "@larksuiteoapi/node-sdk";
import type { Readable } from "node:stream";

import type {
  GatewayProviderInboundEvent,
  GatewayReactionResult,
} from "../../src/provider.js";
import type {
  GatewayChatMember,
  GatewayChatSummary,
  GatewayMemberIDType,
  GatewayMessageSummary,
  GatewayResourceType,
  GatewaySendMessageResult,
  GatewayUserIDType,
} from "../../src/types.js";

export type FeishuGatewayAccountConfig = {
  appId: string;
  appSecret: string;
  verificationToken: string;
  encryptKey: string;
  wsEnabled: boolean;
  wsAutoReconnect: boolean;
  receiveIdType: "chat_id" | "open_id" | "user_id" | "union_id" | "email";
  logLevel: string;
};

type FeishuInboundTransport = "webhook" | "websocket";

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

function toIsoTime(value: unknown): string | null {
  const text = asString(value);
  if (!text) return null;
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 0) return new Date(numeric).toISOString();
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function clamp(limit: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, limit));
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => asString(item)).filter(Boolean))];
}

function defaultUserIDType(config: FeishuGatewayAccountConfig): GatewayUserIDType {
  if (config.receiveIdType === "user_id" || config.receiveIdType === "union_id" || config.receiveIdType === "open_id") return config.receiveIdType;
  return "open_id";
}

function normalizeUserIDType(value: unknown, fallback: GatewayUserIDType): GatewayUserIDType {
  if (value === "user_id" || value === "union_id" || value === "open_id") return value;
  return fallback;
}

function normalizeMemberIDType(value: unknown, fallback: GatewayMemberIDType): GatewayMemberIDType {
  if (value === "user_id" || value === "union_id" || value === "open_id" || value === "app_id") return value;
  return fallback;
}

function normalizeChatMember(item: Record<string, unknown>): GatewayChatMember {
  return {
    memberIDType: asString(item.member_id_type),
    memberID: asString(item.member_id),
    name: asString(item.name),
    tenantKey: asString(item.tenant_key),
  };
}

function flattenPostContent(value: unknown): string {
  const payload = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const parts: string[] = [];
  if (typeof payload.title === "string" && payload.title.trim()) parts.push(payload.title.trim());
  const rows = Array.isArray(payload.content) ? payload.content : [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    for (const item of row) {
      const cell = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const tag = asString(cell.tag);
      if ((tag === "text" || tag === "a") && typeof cell.text === "string" && cell.text.trim()) {
        parts.push(cell.text.trim());
        continue;
      }
      if (tag === "at" && typeof cell.user_name === "string" && cell.user_name.trim()) {
        parts.push(`@${cell.user_name.trim()}`);
        continue;
      }
      if (tag === "img") parts.push("[image]");
    }
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function messagePreview(msgType: string, rawContent: string): string {
  if (!rawContent.trim()) return "";
  try {
    const parsed = JSON.parse(rawContent);
    if (msgType === "text" && parsed && typeof parsed.text === "string") return parsed.text.trim();
    if (msgType === "post") return flattenPostContent(parsed);
    if (msgType === "image") return "[image]";
    if (msgType === "file") return "[file]";
    if (msgType === "audio") return "[audio]";
    if (msgType === "media") return "[media]";
    if (msgType === "interactive") return "[interactive card]";
  } catch {
    return rawContent.trim();
  }
  return rawContent.trim();
}

function toResourceType(value: string): GatewayResourceType | "" {
  if (value === "image" || value === "file" || value === "audio" || value === "media") return value;
  return "";
}

function messageResourceInfo(msgType: string, rawContent: string): { resourceType: GatewayResourceType | ""; resourceKey: string } {
  if (!rawContent.trim()) return { resourceType: "", resourceKey: "" };
  try {
    const parsed = JSON.parse(rawContent);
    const payload = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    if (msgType === "image") {
      const imageKey = asString(payload.image_key) || asString(payload.file_key);
      return { resourceType: imageKey ? "image" : "", resourceKey: imageKey };
    }
    if (msgType === "file" || msgType === "audio" || msgType === "media") {
      const fileKey = asString(payload.file_key);
      return { resourceType: fileKey ? toResourceType(msgType) : "", resourceKey: fileKey };
    }
  } catch {
    return { resourceType: "", resourceKey: "" };
  }
  return { resourceType: "", resourceKey: "" };
}

function normalizeChat(item: Record<string, unknown>, detailError = "", fallbackChatID = ""): GatewayChatSummary {
  return {
    chatID: asString(item.chat_id) || fallbackChatID,
    name: asString(item.name),
    description: asString(item.description),
    avatar: asString(item.avatar),
    chatStatus: asString(item.chat_status),
    chatType: asString(item.chat_type),
    chatMode: asString(item.chat_mode),
    ownerID: asString(item.owner_id),
    ownerIDType: asString(item.owner_id_type),
    tenantKey: asString(item.tenant_key),
    external: Boolean(item.external),
    userCount: asNullableNumber(item.user_count),
    botCount: asNullableNumber(item.bot_count),
    lastMessageTime: null,
    lastMessageType: null,
    lastMessagePreview: "",
    detailError,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeMessage(item: Record<string, unknown>, provider: string, accountID: string): GatewayMessageSummary {
  const body = item.body && typeof item.body === "object" ? (item.body as Record<string, unknown>) : {};
  const sender = item.sender && typeof item.sender === "object" ? (item.sender as Record<string, unknown>) : {};
  const content = typeof body.content === "string" ? body.content : "";
  const msgType = asString(item.msg_type);
  const resource = messageResourceInfo(msgType, content);
  return {
    messageID: asString(item.message_id),
    routeID: "",
    provider,
    accountID,
    chatID: asString(item.chat_id),
    msgType,
    resourceType: resource.resourceType,
    resourceKey: resource.resourceKey,
    createTime: toIsoTime(item.create_time),
    updateTime: toIsoTime(item.update_time),
    deleted: Boolean(item.deleted),
    updated: Boolean(item.updated),
    senderID: asString(sender.id),
    senderType: asString(sender.sender_type),
    preview: messagePreview(msgType, content),
    content,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeInboundEvent(data: Record<string, unknown>): GatewayProviderInboundEvent | null {
  const message = data.message && typeof data.message === "object" ? (data.message as Record<string, unknown>) : {};
  const sender = data.sender && typeof data.sender === "object" ? (data.sender as Record<string, unknown>) : {};
  const senderID = sender.sender_id && typeof sender.sender_id === "object" ? (sender.sender_id as Record<string, unknown>) : {};
  const chat = data.chat && typeof data.chat === "object" ? (data.chat as Record<string, unknown>) : {};
  const content = asString(message.content);
  const messageID = asString(message.message_id);
  const chatID = asString(message.chat_id);
  if (!messageID || !chatID) return null;
  const msgType = asString(message.message_type);
  const resource = messageResourceInfo(msgType, content);
  const now = new Date().toISOString();
  return {
    messageID,
    chatID,
    chatName: asString(chat.name),
    msgType,
    resourceType: resource.resourceType,
    resourceKey: resource.resourceKey,
    senderID: asString(senderID.union_id) || asString(senderID.user_id) || asString(senderID.open_id),
    senderOpenID: asString(senderID.open_id),
    senderType: asString(sender.sender_type),
    preview: messagePreview(msgType, content),
    content,
    createTime: toIsoTime(message.create_time),
    receivedAt: now,
    updatedAt: now,
  };
}

function loggerLevel(level: string): number {
  switch (level.trim().toLowerCase()) {
    case "debug": return lark.LoggerLevel.debug;
    case "warn": return lark.LoggerLevel.warn;
    case "error": return lark.LoggerLevel.error;
    default: return lark.LoggerLevel.info;
  }
}

function detectFileType(fileName: string, mimeType?: string): "opus" | "mp4" | "pdf" | "doc" | "xls" | "ppt" | "stream" {
  const name = fileName.trim().toLowerCase();
  const mime = (mimeType || "").trim().toLowerCase();
  if (mime === "audio/opus") return "opus";
  if (mime === "video/mp4") return "mp4";
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (mime === "application/msword" || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "doc";
  if (mime === "application/vnd.ms-excel" || mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "xls";
  if (mime === "application/vnd.ms-powerpoint" || mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return "ppt";
  if (name.endsWith(".doc") || name.endsWith(".docx")) return "doc";
  if (name.endsWith(".xls") || name.endsWith(".xlsx")) return "xls";
  if (name.endsWith(".ppt") || name.endsWith(".pptx")) return "ppt";
  return "stream";
}

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
    items: GatewayChatMember[];
  }> {
    const limit = clamp(Math.floor(options?.limit || 100), 1, 500);
    const memberIDType = normalizeUserIDType(options?.memberIDType, defaultUserIDType(this.config));
    const items: GatewayChatMember[] = [];
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
      if (total === null) total = asNullableNumber(data.member_total);
      for (const row of rows) {
        const item = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
        items.push(normalizeChatMember(item));
        if (items.length >= limit) break;
      }
      if (data.has_more !== true) break;
      pageToken = asString(data.page_token) || undefined;
      if (!pageToken) break;
    }
    return { chatID, total, items };
  }

  async addChatMembers(chatID: string, input: {
    memberIDs: string[];
    memberIDType?: GatewayMemberIDType;
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
      reactedAt: toIsoTime(response.data?.action_time) || new Date().toISOString(),
    };
  }

  async removeMessageReaction(messageID: string, reactionID: string): Promise<void> {
    await this.client.im.v1.messageReaction.delete({
      path: { message_id: messageID, reaction_id: reactionID },
    });
  }
}
