import type { McpPlugin } from "@opensessiongateway/server-plugin-sdk";
import { errorResult, parseRpc, successResult, textResult } from "@opensessiongateway/server-plugin-sdk";

import type { ImBridgeApp } from "./app.ts";

function normalizeString(value: unknown, name: string): string {
  const clean = typeof value === "string" ? value.trim() : "";
  if (!clean) throw new Error(`${name} is required`);
  return clean;
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

const TOOLS = [
  { name: "GetTransferEndpoint", description: "Return local upload and asset endpoints", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "GetGatewayInfo", description: "Return IM gateway status", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "ListProviders", description: "List installed IM gateway provider plugins", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  {
    name: "ListAccounts",
    description: "List configured IM accounts",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
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

export function createImBridgeSurface(app: ImBridgeApp): McpPlugin {
  return {
    id: "im-gateway.surface",
    routeSegment: "im_gateway",
    info() {
      return {
        ok: true,
        endpoint: "/api/v2/mcp/im_gateway",
        server: "im_gateway",
        implemented: true,
        description: "Multi-route IM gateway surface",
      };
    },
    async handleRpc(body) {
      const { id, method, params } = parseRpc(body);
      if (method === "initialize") {
        return Response.json(successResult(id, {
          protocolVersion: "2025-03-26",
          serverInfo: { name: "im_gateway", version: "0.1.0" },
          capabilities: { tools: { listChanged: false } },
        }));
      }
      if (method === "notifications/initialized") return new Response(null, { status: 202 });
      if (method === "tools/list") return Response.json(successResult(id, { tools: TOOLS }));
      if (method === "tools/call") {
        const toolName = typeof params.name === "string" ? params.name.trim() : "";
        const toolArgs = normalizeObject(params.arguments);
        try {
          if (toolName === "GetTransferEndpoint") return Response.json(successResult(id, textResult(app.getTransferEndpoint())));
          if (toolName === "GetGatewayInfo") return Response.json(successResult(id, textResult(await app.getGatewayInfo())));
          if (toolName === "ListProviders") return Response.json(successResult(id, textResult(app.listProviders())));
          if (toolName === "ListAccounts") return Response.json(successResult(id, textResult(await app.listAccounts())));
          if (toolName === "UpsertAccount") return Response.json(successResult(id, textResult(await app.upsertAccount({
            provider: normalizeString(toolArgs.provider, "provider"),
            accountID: normalizeString(toolArgs.accountID, "accountID"),
            displayName: typeof toolArgs.displayName === "string" ? toolArgs.displayName : undefined,
            enabled: typeof toolArgs.enabled === "boolean" ? toolArgs.enabled : undefined,
            config: normalizeObject(toolArgs.config),
          }))));
          if (toolName === "DeleteAccount") return Response.json(successResult(id, textResult(await app.deleteAccount(normalizeString(toolArgs.provider, "provider"), normalizeString(toolArgs.accountID, "accountID")))));
          if (toolName === "ListAccountChats") return Response.json(successResult(id, textResult(await app.listAccountChats(
            normalizeString(toolArgs.provider, "provider"),
            normalizeString(toolArgs.accountID, "accountID"),
            { limit: normalizeLimit(toolArgs.limit, 20, 50), refresh: normalizeBoolean(toolArgs.refresh, true) },
          ))));
          if (toolName === "ListSessionBindings") return Response.json(successResult(id, textResult(await app.listSessionBindings())));
          if (toolName === "UpsertSessionBinding") return Response.json(successResult(id, textResult(await app.upsertSessionBinding({
            sessionBindingID: normalizeString(toolArgs.sessionBindingID, "sessionBindingID"),
            enabled: typeof toolArgs.enabled === "boolean" ? toolArgs.enabled : undefined,
            runtimeID: typeof toolArgs.runtimeID === "string" ? toolArgs.runtimeID : undefined,
            sessionID: typeof toolArgs.sessionID === "string" ? toolArgs.sessionID : undefined,
            directory: typeof toolArgs.directory === "string" ? toolArgs.directory : undefined,
            displayID: typeof toolArgs.displayID === "string" ? toolArgs.displayID : undefined,
            title: typeof toolArgs.title === "string" ? toolArgs.title : undefined,
            model: typeof toolArgs.model === "string" ? toolArgs.model : undefined,
          }))));
          if (toolName === "CreateSessionBinding") return Response.json(successResult(id, textResult(await app.createSessionBinding({
            sessionBindingID: normalizeString(toolArgs.sessionBindingID, "sessionBindingID"),
            runtimeID: normalizeString(toolArgs.runtimeID, "runtimeID"),
            directory: normalizeString(toolArgs.directory, "directory"),
            displayID: typeof toolArgs.displayID === "string" ? toolArgs.displayID : undefined,
            title: typeof toolArgs.title === "string" ? toolArgs.title : undefined,
            content: typeof toolArgs.content === "string" ? toolArgs.content : undefined,
            model: typeof toolArgs.model === "string" ? toolArgs.model : undefined,
            enabled: typeof toolArgs.enabled === "boolean" ? toolArgs.enabled : undefined,
          }))));
          if (toolName === "DeleteSessionBinding") return Response.json(successResult(id, textResult(await app.deleteSessionBinding(normalizeString(toolArgs.sessionBindingID, "sessionBindingID")))));
          if (toolName === "ListRoutes") return Response.json(successResult(id, textResult(await app.listRoutes())));
          if (toolName === "GetRoute") return Response.json(successResult(id, textResult(await app.getRoute(normalizeString(toolArgs.routeID, "routeID")))));
          if (toolName === "UpsertRoute") return Response.json(successResult(id, textResult(await app.upsertRoute({
            provider: normalizeString(toolArgs.provider, "provider"),
            accountID: normalizeString(toolArgs.accountID, "accountID"),
            chatID: normalizeString(toolArgs.chatID, "chatID"),
            chatName: typeof toolArgs.chatName === "string" ? toolArgs.chatName : undefined,
            enabled: typeof toolArgs.enabled === "boolean" ? toolArgs.enabled : undefined,
            sessionBindingID: typeof toolArgs.sessionBindingID === "string" ? toolArgs.sessionBindingID : undefined,
          }))));
          if (toolName === "DeleteRoute") return Response.json(successResult(id, textResult(await app.deleteRoute(normalizeString(toolArgs.routeID, "routeID")))));
          if (toolName === "ListRouteMessages") return Response.json(successResult(id, textResult(await app.listRouteMessages(normalizeString(toolArgs.routeID, "routeID"), { limit: normalizeLimit(toolArgs.limit, 20, 50), refresh: normalizeBoolean(toolArgs.refresh, true) }))));
          if (toolName === "SendRouteTextMessage") return Response.json(successResult(id, textResult(await app.sendRouteTextMessage(normalizeString(toolArgs.routeID, "routeID"), normalizeString(toolArgs.text, "text")))));
          if (toolName === "RequestUpload") return Response.json(successResult(id, textResult(await app.requestUpload({
            type: normalizeString(toolArgs.type, "type") as "image" | "file",
            routeID: typeof toolArgs.routeID === "string" ? toolArgs.routeID : undefined,
          }))));
          if (toolName === "SendRouteUpload") return Response.json(successResult(id, textResult(await app.sendRouteUpload(normalizeString(toolArgs.routeID, "routeID"), normalizeString(toolArgs.uploadID, "uploadID")))));
          if (toolName === "RequestDownload") return Response.json(successResult(id, textResult(await app.requestDownload({
            routeID: normalizeString(toolArgs.routeID, "routeID"),
            messageID: normalizeString(toolArgs.messageID, "messageID"),
            type: normalizeString(toolArgs.type, "type") as "image" | "file" | "audio" | "media",
          }))));
          if (toolName === "ListRecentRouteEvents") return Response.json(successResult(id, textResult(await app.listRecentRouteEvents(normalizeString(toolArgs.routeID, "routeID"), normalizeLimit(toolArgs.limit, 20, 100)))));
          return Response.json(errorResult(id, -32601, `unknown tool: ${toolName || "<empty>"}`));
        } catch (error) {
          return Response.json(errorResult(id, -32602, error instanceof Error ? error.message : String(error)));
        }
      }
      if (id === undefined || id === null) return new Response(null, { status: 202 });
      return Response.json(errorResult(id, -32601, `method not found: ${method}`));
    },
  };
}
