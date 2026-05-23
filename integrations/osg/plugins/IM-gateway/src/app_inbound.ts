import type { PluginContext } from "@opensessiongateway/server-plugin-sdk";

import type { ImBridgeConfig } from "./config.js";
import type { GatewayProviderInboundEvent } from "./provider.js";
import type { GatewayAccount, GatewayInboundEvent, GatewayRoute, GatewaySessionBinding } from "./types.js";
import { accountKeyOf } from "./types.js";

import {
  type AccountRuntimeEntry,
  type SessionStatusChangeEvent,
  STATUS_BUSY_REACTION_EMOJI,
  readSessionStatusHook,
  toStatusLabel,
} from "./app_helpers.js";
import type { StateStore } from "./state.js";

/** Shape that app_inbound needs from the ImBridgeApp. */
export type AppInboundDeps = {
  readonly config: Pick<ImBridgeConfig, "messagePageSize" | "messageCacheLimit" | "recentEventLimit" | "forwardedInboundCacheLimit">;
  readonly stateStore: StateStore;
  readonly accountRuntimes: Map<string, AccountRuntimeEntry>;
  readonly ctx: PluginContext;
  readonly logger: {
    warn(message: string, extra?: Record<string, unknown>): void;
  };
  requireSessionBinding(sessionBindingID: string): Promise<GatewaySessionBinding>;
  refreshStatusWatches(): Promise<void>;
  upsertRoute(input: {
    provider: string;
    accountID: string;
    chatID: string;
    chatName?: string;
    enabled?: boolean;
    sessionBindingID?: string;
  }): Promise<{ routeID: string; provider: string; accountID: string; chatID: string; chatName: string; enabled: boolean; sessionBindingID: string; updatedAt: string }>;
};

export async function handleProviderInbound(deps: AppInboundDeps, account: GatewayAccount, event: GatewayProviderInboundEvent): Promise<void> {
  const route = await ensureRouteForInbound(deps, account, event);
  const inbound: GatewayInboundEvent = {
    routeID: route.routeID,
    provider: route.provider,
    accountID: route.accountID,
    chatID: route.chatID,
    chatName: event.chatName || route.chatName,
    messageID: event.messageID,
    msgType: event.msgType,
    resourceType: event.resourceType,
    resourceKey: event.resourceKey,
    senderID: event.senderID,
    senderOpenID: event.senderOpenID,
    senderType: event.senderType,
    preview: event.preview,
    content: event.content,
    createTime: event.createTime,
    receivedAt: event.receivedAt,
    updatedAt: event.updatedAt,
  };
  await deps.stateStore.appendInboundEvent(inbound, deps.config.recentEventLimit, deps.config.messageCacheLimit);
  await forwardInboundEventToOsg(deps, route, inbound);
}

export async function pollRoutes(deps: AppInboundDeps): Promise<void> {
  const routes = (await deps.stateStore.listRoutes()).filter((route) => route.enabled);
  for (const route of routes) {
    const entry = deps.accountRuntimes.get(accountKeyOf(route.provider, route.accountID));
    if (!entry) continue;
    try {
      const messages = await entry.runtime.listChatMessages(route.chatID, deps.config.messagePageSize);
      const normalized = messages.map((item) => ({ ...item, routeID: route.routeID, provider: route.provider, accountID: route.accountID, chatID: route.chatID }));
      await deps.stateStore.replaceRouteMessages(route.routeID, normalized, deps.config.messageCacheLimit);
      const userMessages = [...normalized]
        .filter((item) => item.senderType === "user")
        .sort((a, b) => Date.parse(a.createTime || "1970-01-01") - Date.parse(b.createTime || "1970-01-01"));
      if (userMessages.length > 0 && route.sessionBindingID) {
        const binding = await deps.stateStore.getSessionBinding(route.sessionBindingID);
        if (binding && !await verifyRouteBindingTarget(deps, route, binding)) continue;
      }
      for (const message of userMessages) {
        const forwardKey = `${route.routeID}::${message.messageID}`;
        if (await deps.stateStore.hasForwardedInbound(forwardKey)) continue;
        await handleProviderInbound(deps, entry.account, {
          messageID: message.messageID,
          chatID: route.chatID,
          chatName: route.chatName,
          msgType: message.msgType,
          resourceType: message.resourceType,
          resourceKey: message.resourceKey,
          senderID: message.senderID,
          senderOpenID: "",
          senderType: message.senderType,
          preview: message.preview,
          content: message.content,
          createTime: message.createTime,
          receivedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      deps.logger.warn("route poll failed", { routeID: route.routeID, message: error instanceof Error ? error.message : String(error) });
    }
  }
}

export async function refreshStatusWatches(deps: AppInboundDeps): Promise<void> {
  const hook = readSessionStatusHook(deps.ctx);
  if (!hook) return;
  const routes = (await deps.stateStore.listRoutes()).filter((route) => route.enabled && route.sessionBindingID);
  const bindings = await deps.stateStore.listSessionBindings();
  const bindingMap = new Map<string, GatewaySessionBinding>(bindings.map((binding) => [binding.sessionBindingID, binding]));
  const desired = new Map<string, GatewaySessionBinding>();
  for (const route of routes) {
    const binding = bindingMap.get(route.sessionBindingID);
    if (!binding?.enabled || !binding.runtimeID || !binding.sessionID) continue;
    desired.set(`${binding.runtimeID}::${binding.sessionID}`, binding);
  }
  // Note: statusWatchStops management stays in the main app class
  // This function only computes the desired state; actual subscribe/unsubscribe is in ImBridgeApp
  return;
}

export function buildInboundUserMessage(event: GatewayInboundEvent): string {
  if (event.msgType === "text") {
    try {
      const parsed = JSON.parse(event.content || "{}") as { text?: unknown };
      if (typeof parsed.text === "string" && parsed.text.trim()) return parsed.text.trim();
    } catch {
      // ignore
    }
  }
  if (event.preview.trim()) return event.preview.trim();
  if (event.content.trim()) return event.content.trim();
  if (event.msgType === "image") return "[User sent an image]";
  if (event.msgType === "file") return "[User sent a file]";
  if (event.msgType === "audio") return "[User sent audio]";
  if (event.msgType === "media") return "[User sent media]";
  return `[User sent ${event.msgType || "a message"}]`;
}

export function buildInboundSystemPrompt(route: GatewayRoute, binding: GatewaySessionBinding, event: GatewayInboundEvent): string {
  const lines = [
    "<IMGatewayInboundEvent>",
    `routeID=${route.routeID}`,
    `provider=${route.provider}`,
    `accountID=${route.accountID}`,
    `chatID=${route.chatID}`,
    `chatName=${event.chatName || route.chatName}`,
    `messageID=${event.messageID}`,
    `msgType=${event.msgType}`,
    `resourceType=${event.resourceType}`,
    `resourceKey=${event.resourceKey}`,
    `senderID=${event.senderID}`,
    `senderOpenID=${event.senderOpenID}`,
    `senderType=${event.senderType}`,
    `createTime=${event.createTime || ""}`,
    `receivedAt=${event.receivedAt}`,
    `preview=${event.preview}`,
    "</IMGatewayInboundEvent>",
    "",
    "<Instructions>",
    `- Reply to this IM conversation by calling IM Gateway route tools with routeID ${route.routeID}.`,
    `- This route currently binds to sessionBindingID ${binding.sessionBindingID}.`,
    "- Use SendRouteTextMessage for text replies.",
    "- Use RequestUpload plus SendRouteUpload for file/image replies.",
    "- Do not answer in plain text only if the user expects an IM reply.",
    "</Instructions>",
  ];
  return lines.join("\n");
}

export async function verifyRouteBindingTarget(deps: AppInboundDeps, route: GatewayRoute, binding: GatewaySessionBinding): Promise<boolean> {
  if (!binding.enabled || !binding.runtimeID || !binding.sessionID) {
    await noteRouteTargetIssue(deps, route, "offline", "session binding is incomplete or disabled");
    return false;
  }
  const runtimeOnline = await deps.ctx.osg.hasOnlineRuntime(binding.runtimeID).catch(() => false);
  if (!runtimeOnline) {
    await noteRouteTargetIssue(deps, route, "offline", `runtime offline: ${binding.runtimeID}`);
    return false;
  }
  const sessionOnline = await deps.ctx.osg.hasOnlineRuntimeSession(binding.runtimeID, binding.sessionID).catch(() => false);
  if (!sessionOnline) {
    await noteRouteTargetIssue(deps, route, "missing_session", `session not found: ${binding.sessionID}`);
    return false;
  }
  return true;
}

export async function noteRouteTargetIssue(deps: AppInboundDeps, route: GatewayRoute, label: "offline" | "missing_session", detail: string): Promise<void> {
  const previous = await deps.stateStore.getRouteStatus(route.routeID);
  await applyRouteStatus(deps, route, label, detail);
  if (previous?.label === label && (previous.detail || "") === detail) return;
  deps.logger.warn("route target unavailable", {
    routeID: route.routeID,
    sessionBindingID: route.sessionBindingID,
    label,
    message: detail,
  });
}

export async function applyRouteStatus(deps: AppInboundDeps, route: GatewayRoute, label: "idle" | "busy" | "error" | "offline" | "missing_session", detail = ""): Promise<void> {
  const previous = await deps.stateStore.getRouteStatus(route.routeID);
  const runtime = deps.accountRuntimes.get(accountKeyOf(route.provider, route.accountID))?.runtime;
  if (runtime?.addMessageReaction && runtime?.removeMessageReaction) {
    if (label === "busy") {
      const targetMessageID = previous?.targetMessageID || (await deps.stateStore.listRecentInboundEvents(route.routeID, 1))[0]?.messageID || "";
      if (!targetMessageID) {
        await deps.stateStore.saveRouteStatus({ routeID: route.routeID, label, targetMessageID: "", reactionID: "", reactionEmojiType: STATUS_BUSY_REACTION_EMOJI, detail, updatedAt: new Date().toISOString() });
        return;
      }
      if (previous?.label === "busy" && previous.targetMessageID === targetMessageID && previous.reactionID) return;
      if (previous?.reactionID && previous.targetMessageID && previous.targetMessageID !== targetMessageID) {
        await runtime.removeMessageReaction(previous.targetMessageID, previous.reactionID).catch(() => undefined);
      }
      const created = await runtime.addMessageReaction(targetMessageID, STATUS_BUSY_REACTION_EMOJI);
      await deps.stateStore.saveRouteStatus({ routeID: route.routeID, label, targetMessageID, reactionID: created.reactionID, reactionEmojiType: created.emojiType, detail, updatedAt: new Date().toISOString() });
      return;
    }
    if (previous?.reactionID && previous.targetMessageID) {
      await runtime.removeMessageReaction(previous.targetMessageID, previous.reactionID).catch(() => undefined);
    }
    await deps.stateStore.saveRouteStatus({
      routeID: route.routeID,
      label,
      targetMessageID: previous?.targetMessageID || "",
      reactionID: "",
      reactionEmojiType: previous?.reactionEmojiType || STATUS_BUSY_REACTION_EMOJI,
      detail,
      updatedAt: new Date().toISOString(),
    });
    return;
  }
  if (label === "busy") {
    await deps.stateStore.saveRouteStatus({
      routeID: route.routeID,
      label,
      targetMessageID: previous?.targetMessageID || "",
      reactionID: "",
      reactionEmojiType: previous?.reactionEmojiType || STATUS_BUSY_REACTION_EMOJI,
      detail,
      updatedAt: new Date().toISOString(),
    });
    return;
  }
  await deps.stateStore.saveRouteStatus({
    routeID: route.routeID,
    label,
    targetMessageID: previous?.targetMessageID || "",
    reactionID: "",
    reactionEmojiType: previous?.reactionEmojiType || "",
    detail,
    updatedAt: new Date().toISOString(),
  });
}

async function ensureRouteForInbound(deps: AppInboundDeps, account: GatewayAccount, event: GatewayProviderInboundEvent): Promise<GatewayRoute> {
  const { routeIDOf } = await import("./types.js");
  const routeID = routeIDOf(account.provider, account.accountID, event.chatID);
  const existing = await deps.stateStore.getRoute(routeID);
  if (existing) {
    if (event.chatName && event.chatName !== existing.chatName) {
      const updated = { ...existing, chatName: event.chatName, updatedAt: new Date().toISOString() };
      await deps.stateStore.upsertRoute(updated);
      return updated;
    }
    return existing;
  }
  const route: GatewayRoute = {
    routeID,
    provider: account.provider,
    accountID: account.accountID,
    chatID: event.chatID,
    chatName: event.chatName || event.chatID,
    enabled: true,
    sessionBindingID: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await deps.stateStore.upsertRoute(route);
  return route;
}

async function forwardInboundEventToOsg(deps: AppInboundDeps, route: GatewayRoute, event: GatewayInboundEvent): Promise<void> {
  if (!route.enabled || !route.sessionBindingID) return;
  const binding = await deps.requireSessionBinding(route.sessionBindingID);
  if (!binding.enabled || !binding.runtimeID || !binding.sessionID) return;
  if (!await verifyRouteBindingTarget(deps, route, binding)) return;
  const forwardKey = `${route.routeID}::${event.messageID}`;
  if (await deps.stateStore.hasForwardedInbound(forwardKey)) return;
  const addPrompt = deps.ctx.osg.addPrompt as (payload: {
    runtimeID: string;
    sessionID: string;
    msg: string;
    model?: string;
    system?: string;
    source?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  const response = await addPrompt({
    runtimeID: binding.runtimeID,
    sessionID: binding.sessionID,
    msg: buildInboundUserMessage(event),
    model: binding.model || undefined,
    system: buildInboundSystemPrompt(route, binding, event),
  });
  if (!response?.ok) {
    const message = response?.error || "failed to forward inbound event to OSG";
    if (/instance not found/i.test(message) || /session not found/i.test(message)) {
      await noteRouteTargetIssue(deps, route, "missing_session", message);
      return;
    }
    throw new Error(message);
  }
  await deps.stateStore.markForwardedInbound(forwardKey, deps.config.forwardedInboundCacheLimit);
}
