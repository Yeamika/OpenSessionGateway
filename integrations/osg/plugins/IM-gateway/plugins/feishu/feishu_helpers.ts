import * as lark from "@larksuiteoapi/node-sdk";

import type {
  GatewayChatMember,
  GatewayChatSummary,
  GatewayMemberIDType,
  GatewayMessageSummary,
  GatewayResourceType,
  GatewayUserIDType,
} from "../../src/types.js";
import type { GatewayProviderInboundEvent } from "../../src/provider.js";

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

export function asString(value: unknown): string {
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

export function clamp(limit: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, limit));
}

export function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => asString(item)).filter(Boolean))];
}

export function defaultUserIDType(config: FeishuGatewayAccountConfig): GatewayUserIDType {
  if (config.receiveIdType === "user_id" || config.receiveIdType === "union_id" || config.receiveIdType === "open_id") return config.receiveIdType;
  return "open_id";
}

export function normalizeUserIDType(value: unknown, fallback: GatewayUserIDType): GatewayUserIDType {
  if (value === "user_id" || value === "union_id" || value === "open_id") return value;
  return fallback;
}

export function normalizeMemberIDType(value: unknown, fallback: GatewayMemberIDType): GatewayMemberIDType {
  if (value === "user_id" || value === "union_id" || value === "open_id" || value === "app_id") return value;
  return fallback;
}

export function normalizeChatMember(item: Record<string, unknown>): GatewayChatMember {
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

export function messagePreview(msgType: string, rawContent: string): string {
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

export function messageResourceInfo(msgType: string, rawContent: string): { resourceType: GatewayResourceType | ""; resourceKey: string } {
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

export function normalizeChat(item: Record<string, unknown>, detailError = "", fallbackChatID = ""): GatewayChatSummary {
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

export function normalizeMessage(item: Record<string, unknown>, provider: string, accountID: string): GatewayMessageSummary {
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

export function normalizeInboundEvent(data: Record<string, unknown>): GatewayProviderInboundEvent | null {
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

export function loggerLevel(level: string): number {
  switch (level.trim().toLowerCase()) {
    case "debug": return lark.LoggerLevel.debug;
    case "warn": return lark.LoggerLevel.warn;
    case "error": return lark.LoggerLevel.error;
    default: return lark.LoggerLevel.info;
  }
}

export function detectFileType(fileName: string, mimeType?: string): "opus" | "mp4" | "pdf" | "doc" | "xls" | "ppt" | "stream" {
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
