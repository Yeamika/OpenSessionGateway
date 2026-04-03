import type { NextRequest } from "next/server.js";
import { NextResponse } from "next/server.js";

import type { McpPlugin } from "@opensessiongateway/server-plugin-sdk";
import { errorResult, parseRpc, successResult } from "@opensessiongateway/server-plugin-sdk";

import { normalizeInitParams, runtimeIDFromQuery, textResult } from "./common.js";
import type { SessionBridgeServices } from "./types.js";
import { GET_SESSION_MESSAGES_TOOL, createGetSessionMessagesToolHandler } from "./tools/GetSessionMessages.js";
import { LIST_LIVING_SESSIONS_TOOL, createListLivingSessionsToolHandler } from "./tools/ListLivingSessions.js";
import { LIST_MAILBOX_ITEMS_TOOL, createListMailboxItemsToolHandler } from "./tools/ListMailboxItems.js";
import { READ_MAILBOX_ITEM_TOOL, createReadMailboxItemToolHandler } from "./tools/ReadMailboxItem.js";
import { REPLY_MAILBOX_ITEM_TOOL, createReplyMailboxItemToolHandler } from "./tools/ReplyMailboxItem.js";
import { SEND_MAILBOX_ITEM_TOOL, createSendMailboxItemToolHandler } from "./tools/SendMailboxItem.js";

const SESSION_BRIDGE_TOOLS = [
  LIST_LIVING_SESSIONS_TOOL,
  GET_SESSION_MESSAGES_TOOL,
  LIST_MAILBOX_ITEMS_TOOL,
  REPLY_MAILBOX_ITEM_TOOL,
  SEND_MAILBOX_ITEM_TOOL,
  READ_MAILBOX_ITEM_TOOL,
];

export function createSessionBridgeMcpPlugin(services: SessionBridgeServices): McpPlugin {
  const handleGetSessionMessagesTool = createGetSessionMessagesToolHandler(services);
  const handleListLivingSessionsTool = createListLivingSessionsToolHandler(services);
  const handleListMailboxItemsTool = createListMailboxItemsToolHandler(services);
  const handleReadMailboxItemTool = createReadMailboxItemToolHandler(services);
  const handleReplyMailboxItemTool = createReplyMailboxItemToolHandler(services);
  const handleSendMailboxItemTool = createSendMailboxItemToolHandler(services);

  async function handleSessionBridgeRpc(body: unknown, req: NextRequest) {
    const { id, method } = parseRpc(body);
    const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const params = payload.params && typeof payload.params === "object" ? (payload.params as Record<string, unknown>) : {};

    if (method === "initialize") {
      const init = normalizeInitParams(params, req);
      const initRuntimeID = init.runtimeID || runtimeIDFromQuery(req);

      if (!initRuntimeID) {
        return NextResponse.json(errorResult(id, -32602, "initialize requires runtimeID"));
      }

      const runtimeOnline = await services.osg.hasOnlineRuntime(initRuntimeID);
      if (!runtimeOnline) {
        return NextResponse.json(errorResult(id, -32002, "runtimeID is not connected via ws"));
      }

      return NextResponse.json(
        successResult(id, {
          protocolVersion: "2025-03-26",
          serverInfo: {
            name: "session_bridge",
            version: "0.1.0",
          },
          capabilities: {
            tools: { listChanged: false },
          },
        }),
      );
    }

    if (method === "notifications/initialized") {
      return new NextResponse(null, { status: 202 });
    }

    if (method === "tools/list") {
      return NextResponse.json(successResult(id, { tools: SESSION_BRIDGE_TOOLS }));
    }

    if (method === "tools/call") {
      const runtimeID = runtimeIDFromQuery(req);
      if (!runtimeID) {
        return NextResponse.json(errorResult(id, -32001, "runtimeID required in query"));
      }

      const runtimeOnline = await services.osg.hasOnlineRuntime(runtimeID);
      if (!runtimeOnline) {
        return NextResponse.json(errorResult(id, -32002, "handshake runtimeID is offline"));
      }

      const toolName = typeof params.name === "string" ? params.name.trim() : "";
      const toolArgs = params.arguments && typeof params.arguments === "object"
        ? (params.arguments as Record<string, unknown>)
        : {};

      try {
        if (toolName === "ListLivingSessions") {
          return NextResponse.json(successResult(id, textResult(await handleListLivingSessionsTool(toolArgs, runtimeID))));
        }
        if (toolName === "GetSessionMessages") {
          return NextResponse.json(successResult(id, textResult(await handleGetSessionMessagesTool(toolArgs))));
        }
        if (toolName === "ListMailboxItems") {
          return NextResponse.json(successResult(id, textResult(await handleListMailboxItemsTool(toolArgs, runtimeID))));
        }
        if (toolName === "ReplyMailboxItem") {
          return NextResponse.json(successResult(id, textResult(await handleReplyMailboxItemTool(toolArgs, runtimeID))));
        }
        if (toolName === "SendMailboxItem") {
          return NextResponse.json(successResult(id, textResult(await handleSendMailboxItemTool(toolArgs, runtimeID))));
        }
        if (toolName === "ReadMailboxItem") {
          return NextResponse.json(successResult(id, textResult(await handleReadMailboxItemTool(toolArgs, runtimeID))));
        }
        return NextResponse.json(errorResult(id, -32601, `unknown tool: ${toolName || "<empty>"}`));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return NextResponse.json(errorResult(id, -32602, message));
      }
    }

    if (id === undefined || id === null) {
      return new NextResponse(null, { status: 202 });
    }

    return NextResponse.json(errorResult(id, -32601, `method not found: ${method}`));
  }

  return {
    id: "session-bridge.surface",
    routeSegment: "session_bridge",
    info() {
      return {
        ok: true,
        endpoint: "/api/v2/mcp/session_bridge",
        server: "session_bridge",
        description: "Session gateway, network neighbors",
        implemented: true,
      };
    },
    async handleRpc(body, request) {
      return handleSessionBridgeRpc(body, request as NextRequest);
    },
  };
}
