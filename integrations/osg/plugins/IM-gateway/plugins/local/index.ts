import type { GatewayProviderPlugin } from "../../src/provider.js";

import { LocalGatewayClient, type LocalGatewayAccountConfig } from "./client.js";

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeAccountConfig(config: Record<string, unknown>): LocalGatewayAccountConfig {
  return {
    botID: asString(config.botID) || "local-bot",
    botName: asString(config.botName) || "Local Bot",
    defaultChatID: asString(config.defaultChatID),
    defaultChatName: asString(config.defaultChatName),
  };
}

export function createLocalGatewayProvider(): GatewayProviderPlugin {
  return {
    id: "local",
    displayName: "Local Diagnostic IM",
    normalizeAccountConfig(config) {
      return normalizeAccountConfig(config);
    },
    createAccountRuntime({ account, onInboundEvent }) {
      const client = new LocalGatewayClient("local", account.accountID, normalizeAccountConfig(account.config), onInboundEvent);
      return {
        start() { return client.start(); },
        stop() { return client.stop(); },
        getRuntimeInfo() { return client.getRuntimeInfo(); },
        createWebhookHandler(webhookPath) { return client.createWebhookHandler(webhookPath); },
        listChats(limit) { return client.listChats(limit); },
        getChat(chatID) { return client.getChat(chatID); },
        createChat(input) { return client.createChat(input); },
        deleteChat(chatID) { return client.deleteChat(chatID); },
        listChatMembers(chatID, options) { return client.listChatMembers(chatID, options); },
        addChatMembers(chatID, input) { return client.addChatMembers(chatID, input); },
        listChatMessages(chatID, limit) { return client.listChatMessages(chatID, limit); },
        downloadResource(messageID, resourceKey, resourceType) { return client.downloadResource(messageID, resourceKey, resourceType); },
        sendTextMessage(chatID, text) { return client.sendTextMessage(chatID, text); },
        sendImageMessage(chatID, imageKey) { return client.sendImageMessage(chatID, imageKey); },
        sendFileMessage(chatID, fileKey) { return client.sendFileMessage(chatID, fileKey); },
        uploadImage(fileName, content, mimeType) { return client.uploadImage(fileName, content, mimeType); },
        uploadFile(fileName, content, mimeType) { return client.uploadFile(fileName, content, mimeType); },
        addMessageReaction(messageID, emojiType) { return client.addMessageReaction(messageID, emojiType); },
        removeMessageReaction(messageID, reactionID) { return client.removeMessageReaction(messageID, reactionID); },
      };
    },
  };
}
