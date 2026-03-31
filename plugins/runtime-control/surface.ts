import { NextResponse } from "next/server.js";

import type { McpPlugin } from "@opensessiongateway/server-plugin-sdk";
import { errorResult, parseRpc, successResult, textResult } from "@opensessiongateway/server-plugin-sdk";

import { ADD_PROMPT_TOOL, createAddPromptToolHandler } from "./tools/AddPrompt.ts";
import { ABORT_CLIENT_SESSION_TOOL, createAbortClientSessionToolHandler } from "./tools/AbortClientSession.ts";
import { CREATE_NEW_SESSION_TOOL, createCreateNewSessionToolHandler } from "./tools/CreateNewSession.ts";
import { SPAWN_SESSION_TOOL, createSpawnSessionToolHandler } from "./tools/SpawnSession.ts";
import { SET_CLIENT_DISPLAY_SESSION_TOOL, createSetClientDisplaySessionToolHandler } from "./tools/SetClientDisplaySession.ts";
import { GET_SESSION_LAST_USED_MODEL_TOOL, createGetSessionLastUsedModelToolHandler } from "./tools/GetSessionLastUsedModel.ts";
import { GET_RUNTIME_PERMISSION_TOOL, createGetRuntimePermissionToolHandler } from "./tools/GetRuntimePermission.ts";
import { LIST_AVAILABLE_MODELS_TOOL, createListAvailableModelsToolHandler } from "./tools/ListAvailableModels.ts";
import { LIST_CLIENT_SESSIONS_TOOL, createListClientSessionsToolHandler } from "./tools/ListClientSessions.ts";
import { LIST_CLIENT_INSTANCE_WORKSPACES_TOOL, createListClientInstanceWorkspacesToolHandler } from "./tools/ListClientInstanceWorkspaces.ts";
import { LIST_CLIENTS_TOOL, createListClientsToolHandler } from "./tools/ListClients.ts";
import { LIST_RUNTIME_PERMISSIONS_TOOL, createListRuntimePermissionsToolHandler } from "./tools/ListRuntimePermissions.ts";
import { REQUEST_RUNTIME_TOOL, createRequestRuntimeToolHandler } from "./tools/RequestRuntime.ts";
import { RELOAD_CLIENT_INSTANCE_WORKSPACE_TOOL, createReloadClientInstanceWorkspaceToolHandler } from "./tools/ReloadClientInstanceWorkspace.ts";
import { RENAME_CLIENT_SESSION_TOOL, createRenameClientSessionToolHandler } from "./tools/RenameClientSession.ts";
import { RESOLVE_RUNTIME_PERMISSION_TOOL, createResolveRuntimePermissionToolHandler } from "./tools/ResolveRuntimePermission.ts";
import type { RuntimeControlServices } from "./types.ts";

const RUNTIME_CONTROL_TOOLS = [
  LIST_CLIENTS_TOOL,
  LIST_CLIENT_SESSIONS_TOOL,
  CREATE_NEW_SESSION_TOOL,
  ADD_PROMPT_TOOL,
  SPAWN_SESSION_TOOL,
  RENAME_CLIENT_SESSION_TOOL,
  SET_CLIENT_DISPLAY_SESSION_TOOL,
  ABORT_CLIENT_SESSION_TOOL,
  LIST_AVAILABLE_MODELS_TOOL,
  GET_SESSION_LAST_USED_MODEL_TOOL,
  LIST_CLIENT_INSTANCE_WORKSPACES_TOOL,
  REQUEST_RUNTIME_TOOL,
  RELOAD_CLIENT_INSTANCE_WORKSPACE_TOOL,
  LIST_RUNTIME_PERMISSIONS_TOOL,
  GET_RUNTIME_PERMISSION_TOOL,
  RESOLVE_RUNTIME_PERMISSION_TOOL,
];

export function createRuntimeControlMcpPlugin(services: RuntimeControlServices): McpPlugin {
  const handleAddPromptTool = createAddPromptToolHandler(services);
  const handleListClientsTool = createListClientsToolHandler(services);
  const handleListClientSessionsTool = createListClientSessionsToolHandler(services);
  const handleCreateNewSessionTool = createCreateNewSessionToolHandler(services);
  const handleSpawnSessionTool = createSpawnSessionToolHandler(services);
  const handleRenameClientSessionTool = createRenameClientSessionToolHandler(services);
  const handleSetClientDisplaySessionTool = createSetClientDisplaySessionToolHandler(services);
  const handleAbortClientSessionTool = createAbortClientSessionToolHandler(services);
  const handleListAvailableModelsTool = createListAvailableModelsToolHandler(services);
  const handleGetSessionLastUsedModelTool = createGetSessionLastUsedModelToolHandler(services);
  const handleListClientInstanceWorkspacesTool = createListClientInstanceWorkspacesToolHandler(services);
  const handleRequestRuntimeTool = createRequestRuntimeToolHandler(services);
  const handleReloadClientInstanceWorkspaceTool = createReloadClientInstanceWorkspaceToolHandler(services);
  const handleListRuntimePermissionsTool = createListRuntimePermissionsToolHandler(services);
  const handleGetRuntimePermissionTool = createGetRuntimePermissionToolHandler(services);
  const handleResolveRuntimePermissionTool = createResolveRuntimePermissionToolHandler(services);

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
        if (toolName === "ListClients") {
          return NextResponse.json(successResult(id, textResult(await handleListClientsTool(toolArgs))));
        }
        if (toolName === "ListClientSessions") {
          return NextResponse.json(successResult(id, textResult(await handleListClientSessionsTool(toolArgs))));
        }
        if (toolName === "CreateNewSession") {
          return NextResponse.json(successResult(id, textResult(await handleCreateNewSessionTool(toolArgs))));
        }
        if (toolName === "AddPrompt") {
          return NextResponse.json(successResult(id, textResult(await handleAddPromptTool(toolArgs))));
        }
        if (toolName === "SpawnSession") {
          return NextResponse.json(successResult(id, textResult(await handleSpawnSessionTool(toolArgs))));
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
        if (toolName === "ListAvailableModels") {
          return NextResponse.json(successResult(id, textResult(await handleListAvailableModelsTool(toolArgs))));
        }
        if (toolName === "GetSessionLastUsedModel") {
          return NextResponse.json(successResult(id, textResult(await handleGetSessionLastUsedModelTool(toolArgs))));
        }
        if (toolName === "ListClientInstanceWorkspaces") {
          return NextResponse.json(successResult(id, textResult(await handleListClientInstanceWorkspacesTool(toolArgs))));
        }
        if (toolName === "ReloadClientInstanceWorkspace") {
          return NextResponse.json(successResult(id, textResult(await handleReloadClientInstanceWorkspaceTool(toolArgs))));
        }
        if (toolName === "RequestRuntime") {
          return NextResponse.json(successResult(id, textResult(await handleRequestRuntimeTool(toolArgs))));
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
