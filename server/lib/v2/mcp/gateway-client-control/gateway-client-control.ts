import { NextResponse } from "next/server";

import { errorResult, parseRpc, successResult } from "@/lib/v2/mcp/common";
import { ABORT_SESSION_OF_CLIENT_TOOL, handleAbortSessionOfClientTool } from "./tools/AbortSessionOfClient";
import { LIST_AVAILABLE_MODELS_TOOL, handleListAvailableModelsTool } from "./tools/ListAvailableModels";
import { LIST_CLIENT_TOOL, handleListClientTool } from "./tools/ListClient";
import { LIST_LAST_USED_MODEL_OF_SESSION_TOOL, handleListLastUsedModelOfSessionTool } from "./tools/ListLastUsedModelOfSession";
import { LIST_SESSION_OF_CLIENT_TOOL, handleListSessionOfClientTool } from "./tools/ListSessionOfClient";
import { RENAME_SESSION_OF_CLIENT_TOOL, handleRenameSessionOfClientTool } from "./tools/RenameSessionOfClient";
import { SELECT_SESSION_TOOL, handleSelectSessionTool } from "./tools/SelectSession";

export const GATEWAY_CLIENT_CONTROL_TOOLS = [
  LIST_CLIENT_TOOL,
  LIST_SESSION_OF_CLIENT_TOOL,
  RENAME_SESSION_OF_CLIENT_TOOL,
  SELECT_SESSION_TOOL,
  ABORT_SESSION_OF_CLIENT_TOOL,
  LIST_AVAILABLE_MODELS_TOOL,
  LIST_LAST_USED_MODEL_OF_SESSION_TOOL,
];

function textResult(data: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

export async function handleGatewayClientControlRpc(body: unknown) {
  const { id, method } = parseRpc(body);
  const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const params = payload.params && typeof payload.params === "object" ? (payload.params as Record<string, unknown>) : {};

  if (method === "initialize") {
    return NextResponse.json(
      successResult(id, {
        protocolVersion: "2025-03-26",
        serverInfo: {
          name: "gateway_client_control",
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
    return NextResponse.json(successResult(id, { tools: GATEWAY_CLIENT_CONTROL_TOOLS }));
  }

  if (method === "tools/call") {
    const toolName = typeof params.name === "string" ? params.name.trim() : "";
    const toolArgs = params.arguments && typeof params.arguments === "object"
      ? (params.arguments as Record<string, unknown>)
      : {};

    try {
      if (toolName === "ListClient") {
        return NextResponse.json(successResult(id, textResult(await handleListClientTool(toolArgs))));
      }
      if (toolName === "ListSessionOfClient") {
        return NextResponse.json(successResult(id, textResult(await handleListSessionOfClientTool(toolArgs))));
      }
      if (toolName === "RenameSessionOfClient") {
        return NextResponse.json(successResult(id, textResult(await handleRenameSessionOfClientTool(toolArgs))));
      }
      if (toolName === "SelectSession") {
        return NextResponse.json(successResult(id, textResult(await handleSelectSessionTool(toolArgs))));
      }
      if (toolName === "AbortSessionOfClient") {
        return NextResponse.json(successResult(id, textResult(await handleAbortSessionOfClientTool(toolArgs))));
      }
      if (toolName === "ListAvailableModels") {
        return NextResponse.json(successResult(id, textResult(await handleListAvailableModelsTool(toolArgs))));
      }
      if (toolName === "ListLastUsedModelOfSession") {
        return NextResponse.json(successResult(id, textResult(await handleListLastUsedModelOfSessionTool(toolArgs))));
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

export function gatewayClientControlInfo() {
  return {
    ok: true,
    endpoint: "/api/v2/mcp/gateway_client_control",
    server: "gateway_client_control",
    implemented: true,
  };
}
