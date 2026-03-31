import { normalizeString } from "../common.ts";
import type { RuntimeControlServices } from "../types.ts";

export const SPAWN_SESSION_TOOL = {
  name: "SpawnSession",
  description: "Spawn a new session with required InstanceWorkspace, title, model, and prompt",
  inputSchema: {
    type: "object",
    properties: {
      runtimeID: { type: "string", pattern: "\\S", description: "Target client runtimeID" },
      instanceWorkspaceDirectory: { type: "string", pattern: "\\S", description: "Target instanceWorkspaceDirectory" },
      title: { type: "string", pattern: "\\S", description: "Session title" },
      model: { type: "string", pattern: "\\S", description: "Model in provider/model form" },
      promot: { type: "string", pattern: "\\S", description: "Initial prompt content" },
      displayID: { type: "string", description: "Optional target displayID" },
    },
    required: ["runtimeID", "instanceWorkspaceDirectory", "title", "model", "promot"],
    additionalProperties: false,
  },
};

export function createSpawnSessionToolHandler(services: RuntimeControlServices) {
  return async function handleSpawnSessionTool(args: Record<string, unknown>) {
    const runtimeID = normalizeString(args.runtimeID);
    const instanceWorkspaceDirectory = normalizeString(args.instanceWorkspaceDirectory);
    const title = normalizeString(args.title);
    const model = normalizeString(args.model);
    const promot = typeof args.promot === "string" ? args.promot : "";
    const displayID = normalizeString(args.displayID) || undefined;

    await services.osg.requireOnlineRuntime(runtimeID);

    return services.osg.createNewSession({
      runtimeID,
      instanceWorkspaceDirectory,
      content: promot,
      title,
      model,
      displayID,
    });
  };
}
