import { NextResponse } from "next/server.js";

import type { McpPlugin } from "@opensessiongateway/server-plugin-sdk";
import { errorResult, parseRpc, successResult, textResult } from "@opensessiongateway/server-plugin-sdk";

import { ADD_PROMPT_TOOL, createAddPromptToolHandler } from "./tools/AddPrompt.js";
import { ABORT_CLIENT_SESSION_TOOL, createAbortClientSessionToolHandler } from "./tools/AbortClientSession.js";
import { COMPACT_SESSION_TOOL, createCompactSessionToolHandler } from "./tools/CompactSession.js";
import { CREATE_NEW_SESSION_TOOL, createCreateNewSessionToolHandler } from "./tools/CreateNewSession.js";
import { SET_CLIENT_DISPLAY_SESSION_TOOL, createSetClientDisplaySessionToolHandler } from "./tools/SetClientDisplaySession.js";
import { GET_SESSION_LAST_USED_MODEL_TOOL, createGetSessionLastUsedModelToolHandler } from "./tools/GetSessionLastUsedModel.js";
import { GET_RUNTIME_PERMISSION_TOOL, createGetRuntimePermissionToolHandler } from "./tools/GetRuntimePermission.js";
import { GET_RUNTIME_QUESTION_TOOL, createGetRuntimeQuestionToolHandler } from "./tools/GetRuntimeQuestion.js";
import { LIST_RUNTIME_AVAILABLE_MODELS_TOOL, createListRuntimeAvailableModelsToolHandler } from "./tools/ListRuntimeAvailableModels.js";
import { LIST_CLIENT_DISPLAYS_TOOL, createListClientDisplaysToolHandler } from "./tools/ListClientDisplays.js";
import { LIST_ACTIVED_SESSIONS_TOOL, createListActivedSessionsToolHandler } from "./tools/ListActivedSessions.js";
import { LIST_CLIENT_INSTANCE_WORKSPACES_TOOL, createListClientInstanceWorkspacesToolHandler } from "./tools/ListClientInstanceWorkspaces.js";
import { LIST_RUNTIME_QUESTIONS_TOOL, createListRuntimeQuestionsToolHandler } from "./tools/ListRuntimeQuestions.js";
import { LIST_RUNTIME_TOOL, createListRuntimeToolHandler } from "./tools/ListRuntime.js";
import { LIST_RUNTIME_PERMISSIONS_TOOL, createListRuntimePermissionsToolHandler } from "./tools/ListRuntimePermissions.js";
import { REPLY_RUNTIME_QUESTION_TOOL, createReplyRuntimeQuestionToolHandler } from "./tools/ReplyRuntimeQuestion.js";
import { REQUEST_RUNTIME_TOOL, createRequestRuntimeToolHandler } from "./tools/RequestRuntime.js";
import { RELOAD_CLIENT_INSTANCE_WORKSPACE_TOOL, createReloadClientInstanceWorkspaceToolHandler } from "./tools/ReloadClientInstanceWorkspace.js";
import { RENAME_CLIENT_SESSION_TOOL, createRenameClientSessionToolHandler } from "./tools/RenameClientSession.js";
import { RESOLVE_RUNTIME_PERMISSION_TOOL, createResolveRuntimePermissionToolHandler } from "./tools/ResolveRuntimePermission.js";
import type { RuntimeControlServices } from "./types.js";

const RUNTIME_CONTROL_TOOLS = [
  LIST_RUNTIME_TOOL,
  LIST_CLIENT_DISPLAYS_TOOL,
  LIST_ACTIVED_SESSIONS_TOOL,
  LIST_CLIENT_INSTANCE_WORKSPACES_TOOL,
  LIST_RUNTIME_AVAILABLE_MODELS_TOOL,
  GET_SESSION_LAST_USED_MODEL_TOOL,
  REQUEST_RUNTIME_TOOL,
  CREATE_NEW_SESSION_TOOL,
  RENAME_CLIENT_SESSION_TOOL,
  SET_CLIENT_DISPLAY_SESSION_TOOL,
  ABORT_CLIENT_SESSION_TOOL,
  COMPACT_SESSION_TOOL,
  ADD_PROMPT_TOOL,
  RELOAD_CLIENT_INSTANCE_WORKSPACE_TOOL,
  LIST_RUNTIME_PERMISSIONS_TOOL,
  GET_RUNTIME_PERMISSION_TOOL,
  RESOLVE_RUNTIME_PERMISSION_TOOL,
  LIST_RUNTIME_QUESTIONS_TOOL,
  GET_RUNTIME_QUESTION_TOOL,
  REPLY_RUNTIME_QUESTION_TOOL,
];

export function createRuntimeControlMcpPlugin(services: RuntimeControlServices): McpPlugin {
  const handleAddPromptTool = createAddPromptToolHandler(services);
  const handleListRuntimeTool = createListRuntimeToolHandler(services);
  const handleListClientDisplaysTool = createListClientDisplaysToolHandler(services);
  const handleListActivedSessionsTool = createListActivedSessionsToolHandler(services);
  const handleListClientInstanceWorkspacesTool = createListClientInstanceWorkspacesToolHandler(services);
  const handleListRuntimeAvailableModelsTool = createListRuntimeAvailableModelsToolHandler(services);
  const handleGetSessionLastUsedModelTool = createGetSessionLastUsedModelToolHandler(services);
  const handleRequestRuntimeTool = createRequestRuntimeToolHandler(services);
  const handleCreateNewSessionTool = createCreateNewSessionToolHandler(services);
  const handleRenameClientSessionTool = createRenameClientSessionToolHandler(services);
  const handleSetClientDisplaySessionTool = createSetClientDisplaySessionToolHandler(services);
  const handleAbortClientSessionTool = createAbortClientSessionToolHandler(services);
  const handleCompactSessionTool = createCompactSessionToolHandler(services);
  const handleReloadClientInstanceWorkspaceTool = createReloadClientInstanceWorkspaceToolHandler(services);
  const handleListRuntimePermissionsTool = createListRuntimePermissionsToolHandler(services);
  const handleGetRuntimePermissionTool = createGetRuntimePermissionToolHandler(services);
  const handleResolveRuntimePermissionTool = createResolveRuntimePermissionToolHandler(services);
  const handleListRuntimeQuestionsTool = createListRuntimeQuestionsToolHandler(services);
  const handleGetRuntimeQuestionTool = createGetRuntimeQuestionToolHandler(services);
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
        if (toolName === "ListRuntime") {
          return NextResponse.json(successResult(id, textResult(await handleListRuntimeTool(toolArgs))));
        }
        if (toolName === "ListClientDisplays") {
          return NextResponse.json(successResult(id, textResult(await handleListClientDisplaysTool(toolArgs))));
        }
        if (toolName === "ListActivedSessions") {
          return NextResponse.json(successResult(id, textResult(await handleListActivedSessionsTool(toolArgs))));
        }
        if (toolName === "ListClientInstanceWorkspaces") {
          return NextResponse.json(successResult(id, textResult(await handleListClientInstanceWorkspacesTool(toolArgs))));
        }
        if (toolName === "ListRuntimeAvailableModels") {
          return NextResponse.json(successResult(id, textResult(await handleListRuntimeAvailableModelsTool(toolArgs))));
        }
        if (toolName === "GetSessionLastUsedModel") {
          return NextResponse.json(successResult(id, textResult(await handleGetSessionLastUsedModelTool(toolArgs))));
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
        if (toolName === "AbortClientSession") {
          return NextResponse.json(successResult(id, textResult(await handleAbortClientSessionTool(toolArgs))));
        }
        if (toolName === "CompactSession") {
          return NextResponse.json(successResult(id, textResult(await handleCompactSessionTool(toolArgs))));
        }
        if (toolName === "AddPrompt") {
          return NextResponse.json(successResult(id, textResult(await handleAddPromptTool(toolArgs))));
        }
        if (toolName === "ReloadClientInstanceWorkspace") {
          return NextResponse.json(successResult(id, textResult(await handleReloadClientInstanceWorkspaceTool(toolArgs))));
        }
        if (toolName === "ListRuntimePermissions") {
          return NextResponse.json(successResult(id, textResult(await handleListRuntimePermissionsTool(toolArgs))));
        }
        if (toolName === "GetRuntimePermission") {
          return NextResponse.json(successResult(id, textResult(await handleGetRuntimePermissionTool(toolArgs))));
        }
        if (toolName === "ResolveRuntimePermission") {
          return NextResponse.json(successResult(id, textResult(await handleResolveRuntimePermissionTool(toolArgs))));
        }
        if (toolName === "ListRuntimeQuestions") {
          return NextResponse.json(successResult(id, textResult(await handleListRuntimeQuestionsTool(toolArgs))));
        }
        if (toolName === "GetRuntimeQuestion") {
          return NextResponse.json(successResult(id, textResult(await handleGetRuntimeQuestionTool(toolArgs))));
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
