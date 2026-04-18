import type { McpPlugin } from "@opensessiongateway/server-plugin-sdk";
import { errorResult, parseRpc, successResult, textResult } from "@opensessiongateway/server-plugin-sdk";

import type { ImBridgeApp } from "./app.js";

function normalizeString(value: unknown, name: string): string {
  const clean = typeof value === "string" ? value.trim() : "";
  if (!clean) throw new Error(`${name} is required`);
  return clean;
}

function normalizeOptionalString(value: unknown): string | undefined {
  const clean = typeof value === "string" ? value.trim() : "";
  return clean || undefined;
}

function normalizeLimit(value: unknown, fallback: number, max = 50): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.max(1, Math.floor(parsed)));
}

function normalizeBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const clean = value.trim().toLowerCase();
    if (clean === "1" || clean === "true" || clean === "yes" || clean === "on") return true;
    if (clean === "0" || clean === "false" || clean === "no" || clean === "off") return false;
  }
  return fallback;
}

function normalizeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean))];
}

const CONTROL_TOOLS = [
  { name: "GetGatewayInfo", description: "Return IM gateway status", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "ListProviders", description: "List installed IM gateway provider plugins", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "ListAccounts", description: "List configured IM accounts", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  {
    name: "UpsertAccount",
    description: "Create or update one provider account",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string" },
        accountID: { type: "string" },
        displayName: { type: "string" },
        enabled: { type: "boolean" },
        config: { type: "object" },
      },
      required: ["provider", "accountID", "config"],
      additionalProperties: false,
    },
  },
  {
    name: "DeleteAccount",
    description: "Delete one provider account",
    inputSchema: {
      type: "object",
      properties: { provider: { type: "string" }, accountID: { type: "string" } },
      required: ["provider", "accountID"],
      additionalProperties: false,
    },
  },
  {
    name: "ListAccountChats",
    description: "List chats visible to one account",
    inputSchema: {
      type: "object",
      properties: { provider: { type: "string" }, accountID: { type: "string" }, limit: { type: "number" }, refresh: { type: "boolean" } },
      required: ["provider", "accountID"],
      additionalProperties: false,
    },
  },
  {
    name: "CreateAccountChat",
    description: "Create one group chat for one account",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string" },
        accountID: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        ownerID: { type: "string" },
        userIDs: { type: "array", items: { type: "string" } },
        botIDs: { type: "array", items: { type: "string" } },
        userIDType: { type: "string" },
        external: { type: "boolean" },
        chatMode: { type: "string" },
        chatType: { type: "string" },
        setBotManager: { type: "boolean" },
        uuid: { type: "string" },
        sessionBindingID: { type: "string" },
        enabled: { type: "boolean" },
      },
      required: ["provider", "accountID", "name"],
      additionalProperties: false,
    },
  },
  {
    name: "DeleteAccountChat",
    description: "Delete one group chat for one account",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string" },
        accountID: { type: "string" },
        chatID: { type: "string" },
        removeRoute: { type: "boolean" },
      },
      required: ["provider", "accountID", "chatID"],
      additionalProperties: false,
    },
  },
  {
    name: "ListAccountChatMembers",
    description: "List members of one group chat",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string" },
        accountID: { type: "string" },
        chatID: { type: "string" },
        memberIDType: { type: "string" },
        limit: { type: "number" },
      },
      required: ["provider", "accountID", "chatID"],
      additionalProperties: false,
    },
  },
  {
    name: "AddAccountChatMembers",
    description: "Add users or bots into one group chat",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string" },
        accountID: { type: "string" },
        chatID: { type: "string" },
        memberIDs: { type: "array", items: { type: "string" } },
        memberIDType: { type: "string" },
        succeedType: { type: "number" },
      },
      required: ["provider", "accountID", "chatID", "memberIDs"],
      additionalProperties: false,
    },
  },
  { name: "ListSessionBindings", description: "List OSG session bindings", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  {
    name: "UpsertSessionBinding",
    description: "Create or update one OSG session binding",
    inputSchema: {
      type: "object",
      properties: {
        sessionBindingID: { type: "string" },
        enabled: { type: "boolean" },
        runtimeID: { type: "string" },
        sessionID: { type: "string" },
        directory: { type: "string" },
        displayID: { type: "string" },
        title: { type: "string" },
        model: { type: "string" },
      },
      required: ["sessionBindingID"],
      additionalProperties: false,
    },
  },
  {
    name: "CreateSessionBinding",
    description: "Create a new OSG session and store it as one binding",
    inputSchema: {
      type: "object",
      properties: {
        sessionBindingID: { type: "string" },
        runtimeID: { type: "string" },
        directory: { type: "string" },
        displayID: { type: "string" },
        title: { type: "string" },
        content: { type: "string" },
        model: { type: "string" },
        enabled: { type: "boolean" },
      },
      required: ["sessionBindingID", "runtimeID", "directory"],
      additionalProperties: false,
    },
  },
  {
    name: "DeleteSessionBinding",
    description: "Delete one OSG session binding",
    inputSchema: {
      type: "object",
      properties: { sessionBindingID: { type: "string" } },
      required: ["sessionBindingID"],
      additionalProperties: false,
    },
  },
  { name: "ListRoutes", description: "List configured route mappings", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  {
    name: "GetRoute",
    description: "Get one route by routeID",
    inputSchema: { type: "object", properties: { routeID: { type: "string" } }, required: ["routeID"], additionalProperties: false },
  },
  {
    name: "UpsertRoute",
    description: "Create or update one route derived from provider + accountID + chatID",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string" },
        accountID: { type: "string" },
        chatID: { type: "string" },
        chatName: { type: "string" },
        enabled: { type: "boolean" },
        sessionBindingID: { type: "string" },
      },
      required: ["provider", "accountID", "chatID"],
      additionalProperties: false,
    },
  },
  {
    name: "DeleteRoute",
    description: "Delete one route",
    inputSchema: { type: "object", properties: { routeID: { type: "string" } }, required: ["routeID"], additionalProperties: false },
  },
];

const CHAT_TOOLS = [
  { name: "GetTransferEndpoint", description: "Return local upload and asset endpoints", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  {
    name: "ListRouteMessages",
    description: "List recent messages of one route",
    inputSchema: {
      type: "object",
      properties: { routeID: { type: "string" }, limit: { type: "number" }, refresh: { type: "boolean" } },
      required: ["routeID"],
      additionalProperties: false,
    },
  },
  {
    name: "SendRouteTextMessage",
    description: "Send one text message through one route",
    inputSchema: {
      type: "object",
      properties: { routeID: { type: "string" }, text: { type: "string" } },
      required: ["routeID", "text"],
      additionalProperties: false,
    },
  },
  {
    name: "RequestUpload",
    description: "Create one local upload slot and return uploadID plus upload URL",
    inputSchema: {
      type: "object",
      properties: { type: { type: "string" }, routeID: { type: "string" } },
      required: ["type"],
      additionalProperties: false,
    },
  },
  {
    name: "SendRouteUpload",
    description: "Send one uploaded local file through one route",
    inputSchema: {
      type: "object",
      properties: { routeID: { type: "string" }, uploadID: { type: "string" } },
      required: ["routeID", "uploadID"],
      additionalProperties: false,
    },
  },
  {
    name: "RequestDownload",
    description: "Create one assetID and download URL from one route message resource",
    inputSchema: {
      type: "object",
      properties: { routeID: { type: "string" }, messageID: { type: "string" }, type: { type: "string" } },
      required: ["routeID", "messageID", "type"],
      additionalProperties: false,
    },
  },
  {
    name: "ListRecentRouteEvents",
    description: "List recent inbound events for one route",
    inputSchema: {
      type: "object",
      properties: { routeID: { type: "string" }, limit: { type: "number" } },
      required: ["routeID"],
      additionalProperties: false,
    },
  },
];

async function handleControlTool(app: ImBridgeApp, toolName: string, toolArgs: Record<string, unknown>) {
  if (toolName === "GetGatewayInfo") return app.getGatewayInfo();
  if (toolName === "ListProviders") return app.listProviders();
  if (toolName === "ListAccounts") return app.listAccounts();
  if (toolName === "UpsertAccount") return app.upsertAccount({
    provider: normalizeString(toolArgs.provider, "provider"),
    accountID: normalizeString(toolArgs.accountID, "accountID"),
    displayName: normalizeOptionalString(toolArgs.displayName),
    enabled: typeof toolArgs.enabled === "boolean" ? toolArgs.enabled : undefined,
    config: normalizeObject(toolArgs.config),
  });
  if (toolName === "DeleteAccount") return app.deleteAccount(normalizeString(toolArgs.provider, "provider"), normalizeString(toolArgs.accountID, "accountID"));
  if (toolName === "ListAccountChats") return app.listAccountChats(
    normalizeString(toolArgs.provider, "provider"),
    normalizeString(toolArgs.accountID, "accountID"),
    { limit: normalizeLimit(toolArgs.limit, 20, 50), refresh: normalizeBoolean(toolArgs.refresh, true) },
  );
  if (toolName === "CreateAccountChat") return app.createAccountChat({
    provider: normalizeString(toolArgs.provider, "provider"),
    accountID: normalizeString(toolArgs.accountID, "accountID"),
    name: normalizeString(toolArgs.name, "name"),
    description: normalizeOptionalString(toolArgs.description),
    ownerID: normalizeOptionalString(toolArgs.ownerID),
    userIDs: normalizeStringArray(toolArgs.userIDs),
    botIDs: normalizeStringArray(toolArgs.botIDs),
    userIDType: normalizeOptionalString(toolArgs.userIDType) as "user_id" | "union_id" | "open_id" | undefined,
    external: typeof toolArgs.external === "boolean" ? toolArgs.external : undefined,
    chatMode: normalizeOptionalString(toolArgs.chatMode),
    chatType: normalizeOptionalString(toolArgs.chatType),
    setBotManager: typeof toolArgs.setBotManager === "boolean" ? toolArgs.setBotManager : undefined,
    uuid: normalizeOptionalString(toolArgs.uuid),
    sessionBindingID: normalizeOptionalString(toolArgs.sessionBindingID),
    enabled: typeof toolArgs.enabled === "boolean" ? toolArgs.enabled : undefined,
  });
  if (toolName === "DeleteAccountChat") return app.deleteAccountChat({
    provider: normalizeString(toolArgs.provider, "provider"),
    accountID: normalizeString(toolArgs.accountID, "accountID"),
    chatID: normalizeString(toolArgs.chatID, "chatID"),
    removeRoute: typeof toolArgs.removeRoute === "boolean" ? toolArgs.removeRoute : undefined,
  });
  if (toolName === "ListAccountChatMembers") return app.listAccountChatMembers({
    provider: normalizeString(toolArgs.provider, "provider"),
    accountID: normalizeString(toolArgs.accountID, "accountID"),
    chatID: normalizeString(toolArgs.chatID, "chatID"),
    memberIDType: normalizeOptionalString(toolArgs.memberIDType) as "user_id" | "union_id" | "open_id" | undefined,
    limit: normalizeLimit(toolArgs.limit, 100, 500),
  });
  if (toolName === "AddAccountChatMembers") return app.addAccountChatMembers({
    provider: normalizeString(toolArgs.provider, "provider"),
    accountID: normalizeString(toolArgs.accountID, "accountID"),
    chatID: normalizeString(toolArgs.chatID, "chatID"),
    memberIDs: normalizeStringArray(toolArgs.memberIDs),
    memberIDType: normalizeOptionalString(toolArgs.memberIDType) as "user_id" | "union_id" | "open_id" | "app_id" | undefined,
    succeedType: typeof toolArgs.succeedType === "number" ? toolArgs.succeedType : undefined,
  });
  if (toolName === "ListSessionBindings") return app.listSessionBindings();
  if (toolName === "UpsertSessionBinding") return app.upsertSessionBinding({
    sessionBindingID: normalizeString(toolArgs.sessionBindingID, "sessionBindingID"),
    enabled: typeof toolArgs.enabled === "boolean" ? toolArgs.enabled : undefined,
    runtimeID: normalizeOptionalString(toolArgs.runtimeID),
    sessionID: normalizeOptionalString(toolArgs.sessionID),
    directory: normalizeOptionalString(toolArgs.directory),
    displayID: normalizeOptionalString(toolArgs.displayID),
    title: normalizeOptionalString(toolArgs.title),
    model: normalizeOptionalString(toolArgs.model),
  });
  if (toolName === "CreateSessionBinding") return app.createSessionBinding({
    sessionBindingID: normalizeString(toolArgs.sessionBindingID, "sessionBindingID"),
    runtimeID: normalizeString(toolArgs.runtimeID, "runtimeID"),
    directory: normalizeString(toolArgs.directory, "directory"),
    displayID: normalizeOptionalString(toolArgs.displayID),
    title: normalizeOptionalString(toolArgs.title),
    content: normalizeOptionalString(toolArgs.content),
    model: normalizeOptionalString(toolArgs.model),
    enabled: typeof toolArgs.enabled === "boolean" ? toolArgs.enabled : undefined,
  });
  if (toolName === "DeleteSessionBinding") return app.deleteSessionBinding(normalizeString(toolArgs.sessionBindingID, "sessionBindingID"));
  if (toolName === "ListRoutes") return app.listRoutes();
  if (toolName === "GetRoute") return app.getRoute(normalizeString(toolArgs.routeID, "routeID"));
  if (toolName === "UpsertRoute") return app.upsertRoute({
    provider: normalizeString(toolArgs.provider, "provider"),
    accountID: normalizeString(toolArgs.accountID, "accountID"),
    chatID: normalizeString(toolArgs.chatID, "chatID"),
    chatName: normalizeOptionalString(toolArgs.chatName),
    enabled: typeof toolArgs.enabled === "boolean" ? toolArgs.enabled : undefined,
    sessionBindingID: normalizeOptionalString(toolArgs.sessionBindingID),
  });
  if (toolName === "DeleteRoute") return app.deleteRoute(normalizeString(toolArgs.routeID, "routeID"));
  throw new Error(`unknown tool: ${toolName || "<empty>"}`);
}

async function handleChatTool(app: ImBridgeApp, toolName: string, toolArgs: Record<string, unknown>) {
  if (toolName === "GetTransferEndpoint") return app.getTransferEndpoint();
  if (toolName === "ListRouteMessages") return app.listRouteMessages(normalizeString(toolArgs.routeID, "routeID"), {
    limit: normalizeLimit(toolArgs.limit, 20, 50),
    refresh: normalizeBoolean(toolArgs.refresh, true),
  });
  if (toolName === "SendRouteTextMessage") return app.sendRouteTextMessage(normalizeString(toolArgs.routeID, "routeID"), normalizeString(toolArgs.text, "text"));
  if (toolName === "RequestUpload") return app.requestUpload({
    type: normalizeString(toolArgs.type, "type") as "image" | "file",
    routeID: normalizeOptionalString(toolArgs.routeID),
  });
  if (toolName === "SendRouteUpload") return app.sendRouteUpload(normalizeString(toolArgs.routeID, "routeID"), normalizeString(toolArgs.uploadID, "uploadID"));
  if (toolName === "RequestDownload") return app.requestDownload({
    routeID: normalizeString(toolArgs.routeID, "routeID"),
    messageID: normalizeString(toolArgs.messageID, "messageID"),
    type: normalizeString(toolArgs.type, "type") as "image" | "file" | "audio" | "media",
  });
  if (toolName === "ListRecentRouteEvents") return app.listRecentRouteEvents(normalizeString(toolArgs.routeID, "routeID"), normalizeLimit(toolArgs.limit, 20, 100));
  throw new Error(`unknown tool: ${toolName || "<empty>"}`);
}

function createSurface(input: {
  id: string;
  routeSegment: string;
  serverName: string;
  description: string;
  tools: Array<Record<string, unknown>>;
  handler: (app: ImBridgeApp, toolName: string, toolArgs: Record<string, unknown>) => Promise<unknown>;
}, app: ImBridgeApp): McpPlugin {
  return {
    id: input.id,
    routeSegment: input.routeSegment,
    info() {
      return {
        ok: true,
        endpoint: `/api/v2/mcp/${input.routeSegment}`,
        server: input.serverName,
        implemented: true,
        description: input.description,
      };
    },
    async handleRpc(body) {
      const { id, method, params } = parseRpc(body);
      if (method === "initialize") {
        return Response.json(successResult(id, {
          protocolVersion: "2025-03-26",
          serverInfo: { name: input.serverName, version: "0.1.0" },
          capabilities: { tools: { listChanged: false } },
        }));
      }
      if (method === "notifications/initialized") return new Response(null, { status: 202 });
      if (method === "tools/list") return Response.json(successResult(id, { tools: input.tools }));
      if (method === "tools/call") {
        const toolName = typeof params.name === "string" ? params.name.trim() : "";
        const toolArgs = normalizeObject(params.arguments);
        try {
          return Response.json(successResult(id, textResult(await input.handler(app, toolName, toolArgs))));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const code = message.startsWith("unknown tool:") ? -32601 : -32602;
          return Response.json(errorResult(id, code, message));
        }
      }
      if (id === undefined || id === null) return new Response(null, { status: 202 });
      return Response.json(errorResult(id, -32601, `method not found: ${method}`));
    },
  };
}

export function createImGatewayControlSurface(app: ImBridgeApp): McpPlugin {
  return createSurface({
    id: "im-gateway.control",
    routeSegment: "im_gateway_control",
    serverName: "IM-gateway control",
    description: "IM gateway control surface for accounts, groups, bindings, and routes",
    tools: CONTROL_TOOLS,
    handler: handleControlTool,
  }, app);
}

export function createImGatewayChatSurface(app: ImBridgeApp): McpPlugin {
  return createSurface({
    id: "im-gateway.chat",
    routeSegment: "im_gateway_chat",
    serverName: "IM-gateway chat",
    description: "IM gateway chat surface for route messages, uploads, and downloads",
    tools: CHAT_TOOLS,
    handler: handleChatTool,
  }, app);
}
