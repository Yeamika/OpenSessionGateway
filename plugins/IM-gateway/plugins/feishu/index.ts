import type { GatewayProviderPlugin } from "../../src/provider.ts";

import { FeishuGatewayClient, type FeishuGatewayAccountConfig } from "./client.ts";

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const clean = value.trim().toLowerCase();
    if (clean === "1" || clean === "true" || clean === "yes" || clean === "on") return true;
    if (clean === "0" || clean === "false" || clean === "no" || clean === "off") return false;
  }
  return fallback;
}

function envString(name: string): string {
  return process.env[name]?.trim() || "";
}

function normalizeReceiveIdType(value: string): FeishuGatewayAccountConfig["receiveIdType"] {
  if (value === "chat_id" || value === "open_id" || value === "user_id" || value === "union_id" || value === "email") return value;
  return "chat_id";
}

function normalizeAccountConfig(config: Record<string, unknown>): FeishuGatewayAccountConfig {
  const appId = asString(config.appId) || envString("FEISHU_APP_ID");
  const appSecret = asString(config.appSecret) || envString("FEISHU_APP_SECRET");
  if (!appId || !appSecret) throw new Error("feishu account config requires appId and appSecret");
  return {
    appId,
    appSecret,
    verificationToken: asString(config.verificationToken) || envString("FEISHU_VERIFICATION_TOKEN"),
    encryptKey: asString(config.encryptKey) || envString("FEISHU_ENCRYPT_KEY"),
    wsEnabled: asBool(config.wsEnabled, true),
    wsAutoReconnect: asBool(config.wsAutoReconnect, true),
    receiveIdType: normalizeReceiveIdType(asString(config.receiveIdType) || "chat_id"),
    logLevel: asString(config.logLevel) || "info",
  };
}

export function createFeishuGatewayProvider(): GatewayProviderPlugin {
  return {
    id: "feishu",
    displayName: "Feishu",
    normalizeAccountConfig(config) {
      return normalizeAccountConfig(config);
    },
    createAccountRuntime({ account, onInboundEvent }) {
      const client = new FeishuGatewayClient("feishu", account.accountID, normalizeAccountConfig(account.config), onInboundEvent);
      return {
        start() { return client.start(); },
        stop() { return client.stop(); },
        getRuntimeInfo() { return client.getRuntimeInfo(); },
        createWebhookHandler(webhookPath) { return client.createWebhookHandler(webhookPath); },
        listChats(limit) { return client.listChats(limit); },
        getChat(chatID) { return client.getChat(chatID); },
        listChatMessages(chatID, limit) { return client.listChatMessages(chatID, limit); },
        downloadResource(messageID, resourceKey, resourceType) { return client.downloadResource(messageID, resourceKey, resourceType); },
        sendTextMessage(chatID, text) { return client.sendTextMessage(chatID, text); },
        sendImageMessage(chatID, imageKey) { return client.sendImageMessage(chatID, imageKey); },
        sendFileMessage(chatID, fileKey) { return client.sendFileMessage(chatID, fileKey); },
        uploadImage(fileName, content) { return client.uploadImage(fileName, content); },
        uploadFile(fileName, content, mimeType) { return client.uploadFile(fileName, content, mimeType); },
        addMessageReaction(messageID, emojiType) { return client.addMessageReaction(messageID, emojiType); },
        removeMessageReaction(messageID, reactionID) { return client.removeMessageReaction(messageID, reactionID); },
      };
    },
  };
}
