import { Readable } from "node:stream";

import type {
  GatewayProviderInboundEvent,
  GatewayReactionResult,
} from "../../src/provider.js";
import type {
  GatewayChatMember,
  GatewayChatSummary,
  GatewayMessageSummary,
  GatewayResourceType,
  GatewaySendMessageResult,
  GatewayUserIDType,
} from "../../src/types.js";

import {
  asBoolean,
  asString,
  emptyChat,
  json,
  nowIso,
  normalizeMemberIDType,
  normalizeResourceType,
  normalizeUserIDType,
  previewFromContent,
  readJsonBody,
  uniqueStrings,
} from "./local_helpers.js";

export type LocalGatewayAccountConfig = {
  botID: string;
  botName: string;
  defaultChatID: string;
  defaultChatName: string;
};

type LocalResource = {
  key: string;
  type: "image" | "file";
  fileName: string;
  content: Buffer;
  mimeType: string;
  createdAt: string;
};

type LocalReaction = {
  reactionID: string;
  messageID: string;
  emojiType: string;
  createdAt: string;
};

export class LocalGatewayClient {
  private readonly providerID: string;
  private readonly accountID: string;
  private readonly config: LocalGatewayAccountConfig;
  private readonly onInboundEvent: (event: GatewayProviderInboundEvent) => Promise<void>;
  private readonly chats = new Map<string, GatewayChatSummary>();
  private readonly members = new Map<string, GatewayChatMember[]>();
  private readonly messages = new Map<string, GatewayMessageSummary[]>();
  private readonly resources = new Map<string, LocalResource>();
  private readonly reactions = new Map<string, LocalReaction>();
  private sequence = 0;
  private started = false;
  private lastInboundAt: string | null = null;

  constructor(
    providerID: string,
    accountID: string,
    config: LocalGatewayAccountConfig,
    onInboundEvent: (event: GatewayProviderInboundEvent) => Promise<void>,
  ) {
    this.providerID = providerID;
    this.accountID = accountID;
    this.config = config;
    this.onInboundEvent = onInboundEvent;
  }

  async start(): Promise<void> {
    this.started = true;
    if (this.config.defaultChatID) {
      this.ensureChat(this.config.defaultChatID, this.config.defaultChatName || this.config.defaultChatID);
    }
  }

  async stop(): Promise<void> {
    this.started = false;
  }

  getRuntimeInfo() {
    const messageCount = [...this.messages.values()].reduce((sum, rows) => sum + rows.length, 0);
    return {
      localDiagnosticProvider: true,
      started: this.started,
      chatCount: this.chats.size,
      messageCount,
      resourceCount: this.resources.size,
      reactionCount: this.reactions.size,
      lastInboundAt: this.lastInboundAt,
      webhookEnabled: true,
    };
  }

  createWebhookHandler(_webhookPath: string) {
    return async (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
      if (req.method !== "POST") {
        json(res, 405, { ok: false, error: "method_not_allowed" });
        return;
      }
      try {
        const payload = await readJsonBody(req);
        const event = await this.injectInboundMessage(payload);
        json(res, 200, { ok: true, event });
      } catch (error) {
        json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    };
  }

  async listChats(limit: number): Promise<GatewayChatSummary[]> {
    return [...this.chats.values()]
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, Math.min(50, Math.max(1, Math.floor(limit))));
  }

  async getChat(chatID: string): Promise<GatewayChatSummary> {
    const chat = this.chats.get(chatID.trim());
    if (!chat) throw new Error(`local chat not found: ${chatID}`);
    return structuredClone(chat);
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
    const chatID = asString(input.uuid) || this.nextID("chat");
    const chat = emptyChat(chatID, input.name.trim() || chatID);
    chat.description = asString(input.description) || chat.description;
    chat.ownerID = asString(input.ownerID) || chat.ownerID;
    chat.ownerIDType = normalizeUserIDType(input.userIDType);
    chat.external = asBoolean(input.external, false);
    chat.chatMode = asString(input.chatMode) || chat.chatMode;
    chat.chatType = asString(input.chatType) || chat.chatType;
    const userIDs = uniqueStrings(input.userIDs);
    const botIDs = uniqueStrings(input.botIDs);
    chat.userCount = userIDs.length;
    chat.botCount = Math.max(1, botIDs.length || 1);
    chat.updatedAt = nowIso();
    this.chats.set(chatID, chat);
    this.members.set(chatID, [
      ...userIDs.map((memberID) => ({ memberIDType: chat.ownerIDType, memberID, name: memberID, tenantKey: "local" })),
      ...botIDs.map((memberID) => ({ memberIDType: "app_id", memberID, name: memberID, tenantKey: "local" })),
    ]);
    return structuredClone(chat);
  }

  async deleteChat(chatID: string): Promise<void> {
    const clean = chatID.trim();
    this.chats.delete(clean);
    this.members.delete(clean);
    this.messages.delete(clean);
  }

  async listChatMembers(chatID: string, options?: { memberIDType?: GatewayUserIDType; limit?: number }): Promise<{
    chatID: string;
    total: number | null;
    items: GatewayChatMember[];
  }> {
    await this.getChat(chatID);
    const memberIDType = normalizeUserIDType(options?.memberIDType);
    const limit = Math.min(500, Math.max(1, Math.floor(options?.limit || 100)));
    const items = (this.members.get(chatID.trim()) || [])
      .map((item) => ({ ...item, memberIDType: item.memberIDType || memberIDType }))
      .slice(0, limit);
    return { chatID: chatID.trim(), total: items.length, items: structuredClone(items) };
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
    const chat = await this.getChat(chatID);
    const memberIDType = normalizeMemberIDType(input.memberIDType);
    const existing = this.members.get(chat.chatID) || [];
    const existingKeys = new Set(existing.map((item) => `${item.memberIDType}:${item.memberID}`));
    for (const memberID of uniqueStrings(input.memberIDs)) {
      const key = `${memberIDType}:${memberID}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      existing.push({ memberIDType, memberID, name: memberID, tenantKey: "local" });
    }
    this.members.set(chat.chatID, existing);
    chat.userCount = existing.filter((item) => item.memberIDType !== "app_id").length;
    chat.botCount = Math.max(1, existing.filter((item) => item.memberIDType === "app_id").length || 1);
    chat.updatedAt = nowIso();
    this.chats.set(chat.chatID, chat);
    return { invalidIDs: [], notExistedIDs: [], pendingApprovalIDs: [] };
  }

  async listChatMessages(chatID: string, limit: number): Promise<GatewayMessageSummary[]> {
    await this.getChat(chatID);
    return (this.messages.get(chatID.trim()) || [])
      .slice(0, Math.min(50, Math.max(1, Math.floor(limit))))
      .map((item) => structuredClone(item));
  }

  async downloadResource(_messageID: string, resourceKey: string, resourceType: GatewayResourceType): Promise<{ stream: Readable; contentType?: string; fileName?: string }> {
    const resource = this.resources.get(resourceKey.trim());
    if (!resource) throw new Error(`local resource not found: ${resourceKey}`);
    if (resource.type !== resourceType && !(resource.type === "file" && (resourceType === "audio" || resourceType === "media"))) {
      throw new Error(`local resource type mismatch: expected ${resourceType}, got ${resource.type}`);
    }
    return {
      stream: Readable.from(resource.content),
      contentType: resource.mimeType || "application/octet-stream",
      fileName: resource.fileName,
    };
  }

  async sendTextMessage(chatID: string, text: string): Promise<GatewaySendMessageResult> {
    const message = this.createMessage(chatID.trim(), {
      msgType: "text",
      senderID: this.config.botID,
      senderType: "bot",
      content: JSON.stringify({ text }),
    });
    await this.appendMessage(chatID, message);
    return { chatID: chatID.trim(), messageID: message.messageID, msgType: message.msgType, sentAt: message.createTime || nowIso() };
  }

  async sendImageMessage(chatID: string, imageKey: string): Promise<GatewaySendMessageResult> {
    const message = this.createMessage(chatID.trim(), {
      msgType: "image",
      senderID: this.config.botID,
      senderType: "bot",
      content: JSON.stringify({ image_key: imageKey }),
      resourceType: "image",
      resourceKey: imageKey,
    });
    await this.appendMessage(chatID, message);
    return { chatID: chatID.trim(), messageID: message.messageID, msgType: message.msgType, sentAt: message.createTime || nowIso() };
  }

  async sendFileMessage(chatID: string, fileKey: string): Promise<GatewaySendMessageResult> {
    const message = this.createMessage(chatID.trim(), {
      msgType: "file",
      senderID: this.config.botID,
      senderType: "bot",
      content: JSON.stringify({ file_key: fileKey }),
      resourceType: "file",
      resourceKey: fileKey,
    });
    await this.appendMessage(chatID, message);
    return { chatID: chatID.trim(), messageID: message.messageID, msgType: message.msgType, sentAt: message.createTime || nowIso() };
  }

  async uploadImage(fileName: string, content: Buffer, mimeType?: string): Promise<string> {
    return this.saveResource("image", fileName, content, mimeType || "application/octet-stream");
  }

  async uploadFile(fileName: string, content: Buffer, mimeType?: string): Promise<string> {
    return this.saveResource("file", fileName, content, mimeType || "application/octet-stream");
  }

  async addMessageReaction(messageID: string, emojiType: string): Promise<GatewayReactionResult> {
    const reactionID = this.nextID("rea");
    const reaction: LocalReaction = {
      reactionID,
      messageID: messageID.trim(),
      emojiType: emojiType.trim() || "Typing",
      createdAt: nowIso(),
    };
    this.reactions.set(reactionID, reaction);
    return {
      messageID: reaction.messageID,
      reactionID,
      emojiType: reaction.emojiType,
      reactedAt: reaction.createdAt,
    };
  }

  async removeMessageReaction(_messageID: string, reactionID: string): Promise<void> {
    this.reactions.delete(reactionID.trim());
  }

  private async injectInboundMessage(payload: Record<string, unknown>): Promise<GatewayProviderInboundEvent> {
    const chatID = asString(payload.chatID) || this.config.defaultChatID || "local-chat";
    const chatName = asString(payload.chatName) || this.config.defaultChatName || chatID;
    this.ensureChat(chatID, chatName);

    const text = asString(payload.text);
    const msgType = asString(payload.msgType) || (text ? "text" : "text");
    const resourceType = normalizeResourceType(payload.resourceType);
    const resourceKey = asString(payload.resourceKey);
    const content = asString(payload.content) || (msgType === "text" ? JSON.stringify({ text: text || "local inbound message" }) : "");
    const senderID = asString(payload.senderID) || "local-user";
    const createTime = nowIso();
    const message = this.createMessage(chatID, {
      messageID: asString(payload.messageID) || undefined,
      msgType,
      senderID,
      senderType: asString(payload.senderType) || "user",
      content,
      resourceType,
      resourceKey,
      createTime,
    });
    await this.appendMessage(chatID, message);
    const event: GatewayProviderInboundEvent = {
      messageID: message.messageID,
      chatID,
      chatName,
      msgType: message.msgType,
      resourceType: message.resourceType,
      resourceKey: message.resourceKey,
      senderID,
      senderOpenID: asString(payload.senderOpenID) || senderID,
      senderType: message.senderType,
      preview: message.preview,
      content: message.content,
      createTime: message.createTime,
      receivedAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.lastInboundAt = event.receivedAt;
    await this.onInboundEvent(event);
    return event;
  }

  private ensureChat(chatID: string, chatName: string): GatewayChatSummary {
    const clean = chatID.trim();
    const existing = this.chats.get(clean);
    if (existing) {
      if (chatName && existing.name !== chatName) {
        existing.name = chatName;
        existing.updatedAt = nowIso();
        this.chats.set(clean, existing);
      }
      return existing;
    }
    const chat = emptyChat(clean, chatName || clean);
    this.chats.set(clean, chat);
    this.members.set(clean, [
      { memberIDType: "app_id", memberID: this.config.botID, name: this.config.botName, tenantKey: "local" },
    ]);
    return chat;
  }

  private createMessage(chatID: string, input: {
    messageID?: string;
    msgType: string;
    senderID: string;
    senderType: string;
    content: string;
    resourceType?: GatewayResourceType | "";
    resourceKey?: string;
    createTime?: string;
  }): GatewayMessageSummary {
    const content = input.content || "";
    const preview = previewFromContent(input.msgType, content);
    return {
      messageID: input.messageID || this.nextID(input.senderType === "bot" ? "msg_bot" : "msg_user"),
      routeID: "",
      provider: this.providerID,
      accountID: this.accountID,
      chatID,
      msgType: input.msgType,
      resourceType: input.resourceType || "",
      resourceKey: input.resourceKey || "",
      createTime: input.createTime || nowIso(),
      updateTime: null,
      deleted: false,
      updated: false,
      senderID: input.senderID,
      senderType: input.senderType,
      preview,
      content,
      updatedAt: nowIso(),
    };
  }

  private async appendMessage(chatID: string, message: GatewayMessageSummary): Promise<void> {
    const chat = this.ensureChat(chatID, chatID);
    const rows = [
      message,
      ...(this.messages.get(chat.chatID) || []).filter((item) => item.messageID !== message.messageID),
    ];
    rows.sort((a, b) => Date.parse(b.createTime || "1970-01-01") - Date.parse(a.createTime || "1970-01-01"));
    this.messages.set(chat.chatID, rows.slice(0, 200));
    chat.lastMessageTime = message.createTime;
    chat.lastMessageType = message.msgType;
    chat.lastMessagePreview = message.preview;
    chat.updatedAt = nowIso();
    this.chats.set(chat.chatID, chat);
  }

  private saveResource(type: "image" | "file", fileName: string, content: Buffer, mimeType: string): string {
    const key = this.nextID(type === "image" ? "loc_img" : "loc_file");
    this.resources.set(key, {
      key,
      type,
      fileName: fileName.trim() || `${key}.bin`,
      content: Buffer.from(content),
      mimeType,
      createdAt: nowIso(),
    });
    return key;
  }

  private nextID(prefix: string): string {
    this.sequence += 1;
    return `${prefix}_${Date.now().toString(36)}_${this.sequence.toString(36)}`;
  }
}
