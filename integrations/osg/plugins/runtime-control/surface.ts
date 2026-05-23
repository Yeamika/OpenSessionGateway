import { NextResponse } from "next/server.js";

import type { McpPlugin } from "@opensessiongateway/server-plugin-sdk";
import { errorResult, parseRpc, successResult, textResult } from "@opensessiongateway/server-plugin-sdk";

import { ADD_PROMPT_TOOL, createAddPromptToolHandler } from "./tools/AddPrompt.js";
import { CREATE_NEW_SESSION_TOOL, createCreateNewSessionToolHandler } from "./tools/CreateNewSession.js";
import { EXECUTE_SESSION_ACTION_TOOL, createExecuteSessionActionToolHandler } from "./tools/ExecuteSessionAction.js";
import { SET_CLIENT_DISPLAY_SESSION_TOOL, createSetClientDisplaySessionToolHandler } from "./tools/SetClientDisplaySession.js";
import { LIST_CLIENT_DISPLAYS_TOOL, createListClientDisplaysToolHandler } from "./tools/ListClientDisplays.js";
import { LIST_ACTIVED_SESSIONS_TOOL, createListActivedSessionsToolHandler } from "./tools/ListActivedSessions.js";
import { LIST_RUNTIME_QUESTIONS_TOOL, createListRuntimeQuestionsToolHandler } from "./tools/ListRuntimeQuestions.js";
import { LIST_RUNTIME_TREE_TOOL, createListRuntimeTreeToolHandler } from "./tools/ListRuntimeTree.js";
import { LIST_RUNTIME_PERMISSIONS_TOOL, createListRuntimePermissionsToolHandler } from "./tools/ListRuntimePermissions.js";
import { REPLY_RUNTIME_QUESTION_TOOL, createReplyRuntimeQuestionToolHandler } from "./tools/ReplyRuntimeQuestion.js";
import { REQUEST_RUNTIME_TOOL, createRequestRuntimeToolHandler } from "./tools/RequestRuntime.js";
import { RENAME_CLIENT_SESSION_TOOL, createRenameClientSessionToolHandler } from "./tools/RenameClientSession.js";
import { RESOLVE_RUNTIME_PERMISSION_TOOL, createResolveRuntimePermissionToolHandler } from "./tools/ResolveRuntimePermission.js";
import type { RuntimeControlServices } from "./types.js";

const RUNTIME_CONTROL_TOOLS = [
  LIST_RUNTIME_TREE_TOOL,
  LIST_CLIENT_DISPLAYS_TOOL,
  LIST_ACTIVED_SESSIONS_TOOL,
  REQUEST_RUNTIME_TOOL,
  CREATE_NEW_SESSION_TOOL,
  RENAME_CLIENT_SESSION_TOOL,
  SET_CLIENT_DISPLAY_SESSION_TOOL,
  EXECUTE_SESSION_ACTION_TOOL,
  ADD_PROMPT_TOOL,
  LIST_RUNTIME_PERMISSIONS_TOOL,
  RESOLVE_RUNTIME_PERMISSION_TOOL,
  LIST_RUNTIME_QUESTIONS_TOOL,
  REPLY_RUNTIME_QUESTION_TOOL,
];

export function createRuntimeControlMcpPlugin(services: RuntimeControlServices): McpPlugin {
  const handleAddPromptTool = createAddPromptToolHandler(services);
  const handleListRuntimeTreeTool = createListRuntimeTreeToolHandler(services);
  const handleListClientDisplaysTool = createListClientDisplaysToolHandler(services);
  const handleListActivedSessionsTool = createListActivedSessionsToolHandler(services);
  const handleRequestRuntimeTool = createRequestRuntimeToolHandler(services);
  const handleCreateNewSessionTool = createCreateNewSessionToolHandler(services);
  const handleRenameClientSessionTool = createRenameClientSessionToolHandler(services);
  const handleSetClientDisplaySessionTool = createSetClientDisplaySessionToolHandler(services);
  const handleExecuteSessionActionTool = createExecuteSessionActionToolHandler(services);
  const handleListRuntimePermissionsTool = createListRuntimePermissionsToolHandler(services);
  const handleResolveRuntimePermissionTool = createResolveRuntimePermissionToolHandler(services);
  const handleListRuntimeQuestionsTool = createListRuntimeQuestionsToolHandler(services);
  const handleReplyRuntimeQuestionTool = createReplyRuntimeQuestionToolHandler(services);

  async function handleRuntimeControlRpc(body: unknown) {
    const { id, method, params } = parseRpc(body);

    if (method === "initialize") {
      return NextResponse.json(
        successResult(id, {
          protocolVersion: "2025-03-26",
          serverInfo: {
            name: "runtime_control",
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
      return NextResponse.json(successResult(id, { tools: RUNTIME_CONTROL_TOOLS }));
    }

    if (method === "tools/call") {
      const toolName = typeof params.name === "string" ? params.name.trim() : "";
      const toolArgs = params.arguments && typeof params.arguments === "object"
        ? (params.arguments as Record<string, unknown>)
        : {};

      try {
        if (toolName === "ListRuntimeTree") {
          return NextResponse.json(successResult(id, textResult(await handleListRuntimeTreeTool(toolArgs))));
        }
        if (toolName === "ListClientDisplays") {
          return NextResponse.json(successResult(id, textResult(await handleListClientDisplaysTool(toolArgs))));
        }
        if (toolName === "ListActivedSessions") {
          return NextResponse.json(successResult(id, textResult(await handleListActivedSessionsTool(toolArgs))));
        }
        if (toolName === "RequestRuntime") {
          return NextResponse.json(successResult(id, textResult(await handleRequestRuntimeTool(toolArgs))));
        }
        if (toolName === "CreateNewSession") {
          return NextResponse.json(successResult(id, textResult(await handleCreateNewSessionTool(toolArgs))));
        }
        if (toolName === "RenameClientSession") {
          return NextResponse.json(successResult(id, textResult(await handleRenameClientSessionTool(toolArgs))));
        }
        if (toolName === "SetClientDisplaySession") {
          return NextResponse.json(successResult(id, textResult(await handleSetClientDisplaySessionTool(toolArgs))));
        }
        if (toolName === "ExecuteSessionAction") {
          return NextResponse.json(successResult(id, textResult(await handleExecuteSessionActionTool(toolArgs))));
        }
        if (toolName === "AddPrompt") {
          return NextResponse.json(successResult(id, textResult(await handleAddPromptTool(toolArgs))));
        }
        if (toolName === "ListRuntimePermissions") {
          return NextResponse.json(successResult(id, textResult(await handleListRuntimePermissionsTool(toolArgs))));
        }
        if (toolName === "ResolveRuntimePermission") {
          return NextResponse.json(successResult(id, textResult(await handleResolveRuntimePermissionTool(toolArgs))));
        }
        if (toolName === "ListRuntimeQuestions") {
          return NextResponse.json(successResult(id, textResult(await handleListRuntimeQuestionsTool(toolArgs))));
        }
        if (toolName === "ReplyRuntimeQuestion") {
          return NextResponse.json(successResult(id, textResult(await handleReplyRuntimeQuestionTool(toolArgs))));
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
    id: "runtime-control.surface",
    routeSegment: "runtime_control",
    info() {
      return {
        ok: true,
        endpoint: "/api/v2/mcp/runtime_control",
        server: "runtime_control",
        implemented: true,
      };
    },
    async handleRpc(body) {
      return handleRuntimeControlRpc(body);
    },
  };
}
