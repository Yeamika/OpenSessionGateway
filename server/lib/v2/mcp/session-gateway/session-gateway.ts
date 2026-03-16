import { NextRequest, NextResponse } from "next/server";

import { bindCallerToRuntime, resolveRuntimeByCaller } from "@/lib/runtime-hub";
import { hasOnlineRuntime } from "@/lib/runtime-validation";
import { errorResult, parseRpc, successResult } from "@/lib/v2/mcp/common";
import { callerKey, normalizeInitParams, runtimeIDFromQuery, textResult } from "./common";
import { ADD_PROMOT_TOOL, handleAddPromotTool } from "./tools/AddPromot";
import { GET_MAILBOX_TOOL, handleGetMailboxTool } from "./tools/GetMailbox";
import { GET_SESSION_MSG_TOOL, handleGetSessionMsgTool } from "./tools/GetSessionMsg";
import { LIST_LIVING_SESSION_TOOL, handleListLivingSessionTool } from "./tools/ListLivingSession";
import { READ_MAIL_TOOL, handleReadMailTool } from "./tools/ReadMail";
import { REPLAY_MAIL_TOOL, handleReplayMailTool } from "./tools/ReplayMail";
import { SEND_MAIL_TOOL, handleSendMailTool } from "./tools/SendMail";

export const SESSION_GATEWAY_TOOLS = [
  LIST_LIVING_SESSION_TOOL,
  GET_SESSION_MSG_TOOL,
  GET_MAILBOX_TOOL,
  REPLAY_MAIL_TOOL,
  SEND_MAIL_TOOL,
  READ_MAIL_TOOL,
  ADD_PROMOT_TOOL,
];

export async function handleSessionGatewayRpc(body: unknown, req: NextRequest) {
  const { id, method } = parseRpc(body);
  const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const params = payload.params && typeof payload.params === "object" ? (payload.params as Record<string, unknown>) : {};

  if (method === "initialize") {
    const init = normalizeInitParams(params, req);
    const initRuntimeID = init.runtimeID || runtimeIDFromQuery(req);

    if (!initRuntimeID) {
      return NextResponse.json(errorResult(id, -32602, "initialize requires runtimeID"));
    }

    const runtimeOnline = await hasOnlineRuntime(initRuntimeID);
    if (!runtimeOnline) {
      return NextResponse.json(errorResult(id, -32002, "runtimeID is not connected via ws"));
    }

    const key = callerKey(req);
    if (key && initRuntimeID) {
      bindCallerToRuntime(key, initRuntimeID);
    }

    return NextResponse.json(
      successResult(id, {
        protocolVersion: "2025-03-26",
        serverInfo: {
          name: "session_gateway",
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
    return NextResponse.json(successResult(id, { tools: SESSION_GATEWAY_TOOLS }));
  }

  if (method === "tools/call") {
    const runtimeID = runtimeIDFromQuery(req) || resolveRuntimeByCaller(callerKey(req));
    if (!runtimeID) {
      return NextResponse.json(errorResult(id, -32001, "runtimeID required in query"));
    }

    const runtimeOnline = await hasOnlineRuntime(runtimeID);
    if (!runtimeOnline) {
      return NextResponse.json(errorResult(id, -32002, "handshake runtimeID is offline"));
    }

    const toolName = typeof params.name === "string" ? params.name.trim() : "";
    const toolArgs = params.arguments && typeof params.arguments === "object"
      ? (params.arguments as Record<string, unknown>)
      : {};

    try {
      if (toolName === "ListLivingSession") {
        return NextResponse.json(successResult(id, textResult(await handleListLivingSessionTool(toolArgs, runtimeID))));
      }
      if (toolName === "GetSessionMsg") {
        return NextResponse.json(successResult(id, textResult(await handleGetSessionMsgTool(toolArgs))));
      }
      if (toolName === "GetMailbox") {
        return NextResponse.json(successResult(id, textResult(await handleGetMailboxTool(toolArgs, runtimeID))));
      }
      if (toolName === "ReplayMail") {
        return NextResponse.json(successResult(id, textResult(await handleReplayMailTool(toolArgs, runtimeID))));
      }
      if (toolName === "SendMail") {
        return NextResponse.json(successResult(id, textResult(await handleSendMailTool(toolArgs, runtimeID))));
      }
      if (toolName === "ReadMail") {
        return NextResponse.json(successResult(id, textResult(await handleReadMailTool(toolArgs, runtimeID))));
      }
      if (toolName === "AddPromot") {
        return NextResponse.json(successResult(id, textResult(await handleAddPromotTool(toolArgs, runtimeID))));
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

export function sessionGatewayInfo() {
  return {
    ok: true,
    endpoint: "/api/v2/mcp/session_gateway",
    server: "session_gateway",
    description: "Session gateway, network neighbors",
    implemented: true,
  };
}
