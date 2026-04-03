import { normalizeString } from "../common.js";
import type { RuntimeControlServices } from "../types.js";

export const RELOAD_CLIENT_INSTANCE_WORKSPACE_TOOL = {
  name: "ReloadClientInstanceWorkspace",
  description: "Request one client runtime to reload one InstanceWorkspace",
  inputSchema: {
    type: "object",
    properties: {
      runtimeID: { type: "string", pattern: "\\S", description: "Target client runtimeID" },
      instanceWorkspaceDirectory: { type: "string", description: "Optional instanceWorkspaceDirectory" },
      title: { type: "string", description: "Optional InstanceWorkspace title" },
    },
    required: ["runtimeID"],
    additionalProperties: false,
  },
};

export function createReloadClientInstanceWorkspaceToolHandler(services: RuntimeControlServices) {
  return async function handleReloadClientInstanceWorkspaceTool(args: Record<string, unknown>) {
    const runtimeID = normalizeString(args.runtimeID);
    const instanceWorkspaceDirectory = normalizeString(args.instanceWorkspaceDirectory) || undefined;
    const title = normalizeString(args.title) || undefined;

    await services.osg.requireOnlineRuntime(runtimeID);

    if (!instanceWorkspaceDirectory && !title) {
      throw new Error("one of instanceWorkspaceDirectory or title is required");
    }

    return services.osg.reloadClientInstanceWorkspace({ runtimeID, instanceWorkspaceDirectory, title });
  };
}
