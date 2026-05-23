import type { GatewayProviderAccountRuntime } from "./provider.js";
import type { GatewayAccount, GatewayChatSummary, GatewayMemberIDType, GatewayUserIDType } from "./types.js";
import { accountKeyOf, routeIDOf } from "./types.js";

import { type AccountRuntimeEntry, accountPublic, requireString } from "./app_helpers.js";
import type { ImBridgeConfig } from "./config.js";
import type { StateStore } from "./state.js";

export type AppAccountDeps = {
  readonly config: ImBridgeConfig;
  readonly stateStore: StateStore;
  readonly accountRuntimes: Map<string, AccountRuntimeEntry>;
  readonly logger: {
    warn(message: string, extra?: Record<string, unknown>): void;
  };
  requireAccount(providerID: string, accountID: string): Promise<GatewayAccount>;
  requireAccountRuntime(provider: string, accountID: string): Promise<GatewayProviderAccountRuntime>;
  requireSessionBinding(sessionBindingID: string): Promise<import("./types.js").GatewaySessionBinding>;
  upsertRoute(input: {
    provider: string;
    accountID: string;
    chatID: string;
    chatName?: string;
    enabled?: boolean;
    sessionBindingID?: string;
  }): Promise<{ routeID: string; provider: string; accountID: string; chatID: string; chatName: string; enabled: boolean; sessionBindingID: string; updatedAt: string }>;
  refreshStatusWatches(): Promise<void>;
  startAccountRuntime(account: GatewayAccount): Promise<void>;
  stopAccountRuntime(provider: string, accountID: string): Promise<void>;
  getProvider(id: string): { id: string; normalizeAccountConfig?: (config: Record<string, unknown>) => Record<string, unknown> };
};

export async function listAccounts(deps: AppAccountDeps) {
  const accounts = await deps.stateStore.listAccounts();
  const items = await Promise.all(accounts.map(async (account) => {
    const runtimeInfo = await deps.accountRuntimes.get(accountKeyOf(account.provider, account.accountID))?.runtime.getRuntimeInfo?.() ?? null;
    return accountPublic(account, runtimeInfo);
  }));
  return { count: items.length, items };
}

export async function upsertAccount(deps: AppAccountDeps, input: {
  provider: string;
  accountID: string;
  displayName?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
}) {
  const provider = deps.getProvider(requireString(input.provider, "provider"));
  const accountID = requireString(input.accountID, "accountID");
  const previous = await deps.stateStore.getAccount(provider.id, accountID);
  const now = new Date().toISOString();
  const config = provider.normalizeAccountConfig ? provider.normalizeAccountConfig(input.config || {}) : (input.config || {});
  const account: GatewayAccount = {
    provider: provider.id,
    accountID,
    displayName: input.displayName?.trim() || previous?.displayName || accountID,
    enabled: input.enabled ?? previous?.enabled ?? true,
    config,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
  };
  await deps.stateStore.upsertAccount(account);
  if (account.enabled) {
    await deps.startAccountRuntime(account);
  } else {
    await deps.stopAccountRuntime(account.provider, account.accountID);
  }
  return accountPublic(account, await deps.accountRuntimes.get(accountKeyOf(account.provider, account.accountID))?.runtime.getRuntimeInfo?.() ?? null);
}

export async function deleteAccount(deps: AppAccountDeps, providerID: string, accountID: string) {
  const account = await deps.stateStore.getAccount(providerID.trim().toLowerCase(), accountID);
  if (!account || account.provider !== providerID.trim().toLowerCase()) throw new Error(`account not found: ${providerID}/${accountID}`);
  const routes = (await deps.stateStore.listRoutes()).filter((route) => route.accountID === accountID && route.provider === account.provider);
  if (routes.length) throw new Error(`account still has routes: ${routes.map((item) => item.routeID).join(", ")}`);
  await deps.stopAccountRuntime(account.provider, accountID);
  await deps.stateStore.removeAccount(account.provider, accountID);
  return { ok: true, provider: account.provider, accountID };
}

export async function listAccountChats(deps: AppAccountDeps, providerID: string, accountID: string, options?: { limit?: number; refresh?: boolean }) {
  const account = await deps.requireAccount(providerID, accountID);
  const runtime = await deps.requireAccountRuntime(account.provider, account.accountID);
  const limit = Math.min(50, Math.max(1, Math.floor(options?.limit || deps.config.chatPageSize)));
  const chats = await runtime.listChats(limit);
  return {
    provider: account.provider,
    accountID: account.accountID,
    count: chats.length,
    items: chats.map((chat) => ({
      routeID: routeIDOf(account.provider, account.accountID, chat.chatID),
      chatID: chat.chatID,
      name: chat.name,
      chatMode: chat.chatMode,
      chatType: chat.chatType,
      userCount: chat.userCount,
      botCount: chat.botCount,
      ownerID: chat.ownerID,
      ownerIDType: chat.ownerIDType,
      external: chat.external,
      lastMessageTime: chat.lastMessageTime,
      lastMessagePreview: chat.lastMessagePreview,
      detailError: chat.detailError,
    })),
  };
}

export async function createAccountChat(deps: AppAccountDeps, input: {
  provider: string;
  accountID: string;
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
  sessionBindingID?: string;
  enabled?: boolean;
}) {
  const account = await deps.requireAccount(input.provider, input.accountID);
  if (input.sessionBindingID?.trim()) await deps.requireSessionBinding(input.sessionBindingID);
  const runtime = await deps.requireAccountRuntime(account.provider, account.accountID);
  if (typeof runtime.createChat !== "function") throw new Error(`provider does not support chat creation: ${account.provider}`);
  const chat = await runtime.createChat({
    name: requireString(input.name, "name"),
    description: input.description?.trim() || undefined,
    ownerID: input.ownerID?.trim() || undefined,
    userIDs: Array.isArray(input.userIDs) ? input.userIDs : [],
    botIDs: Array.isArray(input.botIDs) ? input.botIDs : [],
    userIDType: input.userIDType,
    external: input.external,
    chatMode: input.chatMode?.trim() || undefined,
    chatType: input.chatType?.trim() || undefined,
    setBotManager: input.setBotManager,
    uuid: input.uuid?.trim() || undefined,
  });
  const route = await deps.upsertRoute({
    provider: account.provider,
    accountID: account.accountID,
    chatID: chat.chatID,
    chatName: chat.name || input.name,
    enabled: input.enabled,
    sessionBindingID: input.sessionBindingID,
  });
  await deps.stateStore.saveChat(route.routeID, structuredClone(chat));
  return {
    provider: account.provider,
    accountID: account.accountID,
    routeID: route.routeID,
    route,
    chat,
  };
}

export async function deleteAccountChat(deps: AppAccountDeps, input: { provider: string; accountID: string; chatID: string; removeRoute?: boolean }) {
  const account = await deps.requireAccount(input.provider, input.accountID);
  const runtime = await deps.requireAccountRuntime(account.provider, account.accountID);
  if (typeof runtime.deleteChat !== "function") throw new Error(`provider does not support chat deletion: ${account.provider}`);
  const chatID = requireString(input.chatID, "chatID");
  await runtime.deleteChat(chatID);
  const routeID = routeIDOf(account.provider, account.accountID, chatID);
  const route = await deps.stateStore.getRoute(routeID);
  if (route && input.removeRoute !== false) {
    await deps.stateStore.removeRoute(routeID);
    await deps.refreshStatusWatches();
  }
  return {
    ok: true,
    provider: account.provider,
    accountID: account.accountID,
    chatID,
    routeID,
    routeRemoved: Boolean(route && input.removeRoute !== false),
  };
}

export async function listAccountChatMembers(deps: AppAccountDeps, input: {
  provider: string;
  accountID: string;
  chatID: string;
  memberIDType?: GatewayUserIDType;
  limit?: number;
}) {
  const account = await deps.requireAccount(input.provider, input.accountID);
  const runtime = await deps.requireAccountRuntime(account.provider, account.accountID);
  if (typeof runtime.listChatMembers !== "function") throw new Error(`provider does not support listing chat members: ${account.provider}`);
  const chatID = requireString(input.chatID, "chatID");
  const result = await runtime.listChatMembers(chatID, {
    memberIDType: input.memberIDType,
    limit: Math.min(500, Math.max(1, Math.floor(input.limit || 100))),
  });
  return {
    provider: account.provider,
    accountID: account.accountID,
    routeID: routeIDOf(account.provider, account.accountID, chatID),
    chatID,
    total: result.total,
    count: result.items.length,
    items: result.items,
  };
}

export async function addAccountChatMembers(deps: AppAccountDeps, input: {
  provider: string;
  accountID: string;
  chatID: string;
  memberIDs: string[];
  memberIDType?: GatewayMemberIDType;
  succeedType?: number;
}) {
  const account = await deps.requireAccount(input.provider, input.accountID);
  const runtime = await deps.requireAccountRuntime(account.provider, account.accountID);
  if (typeof runtime.addChatMembers !== "function") throw new Error(`provider does not support adding chat members: ${account.provider}`);
  const chatID = requireString(input.chatID, "chatID");
  const memberIDs = [...new Set((Array.isArray(input.memberIDs) ? input.memberIDs : []).map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean))];
  if (!memberIDs.length) throw new Error("memberIDs is required");
  const result = await runtime.addChatMembers(chatID, {
    memberIDs,
    memberIDType: input.memberIDType,
    succeedType: typeof input.succeedType === "number" ? Math.max(0, Math.floor(input.succeedType)) : undefined,
  });
  const routeID = routeIDOf(account.provider, account.accountID, chatID);
  const route = await deps.stateStore.getRoute(routeID);
  if (route) {
    try {
      await deps.stateStore.saveChat(routeID, await runtime.getChat(chatID));
    } catch {
      // ignore chat refresh failure after member change
    }
  }
  return {
    provider: account.provider,
    accountID: account.accountID,
    routeID,
    chatID,
    requestedCount: memberIDs.length,
    invalidIDs: result.invalidIDs,
    notExistedIDs: result.notExistedIDs,
    pendingApprovalIDs: result.pendingApprovalIDs,
  };
}
