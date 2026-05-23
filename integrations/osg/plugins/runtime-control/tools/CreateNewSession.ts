import { normalizeString } from "../common.js";
import type { RuntimeControlServices } from "../types.js";

export const CREATE_NEW_SESSION_TOOL = {
  name: "CreateNewSession",
  description: "Create one session in a target runtime with initial content",
  inputSchema: {
    type: "object",
    properties: {
      ExecutorSessionID: { type: "string", pattern: "\\S", description: "Executor sessionID" },
      runtimeID: { type: "string", pattern: "\\S", description: "Target client runtimeID" },
      instanceWorkspaceDirectory: { type: "string", pattern: "\\S", description: "Target instanceWorkspaceDirectory" },
      content: { type: "string", pattern: "\\S", description: "Initial session content" },
      title: { type: "string", description: "Optional session title" },
      agent: { type: "string", description: "Optional agent name" },
      displayID: { type: "string", description: "Optional target displayID" },
    },
    required: ["ExecutorSessionID", "runtimeID", "instanceWorkspaceDirectory", "content"],
    additionalProperties: false,
  },
};

export function createCreateNewSessionToolHandler(services: RuntimeControlServices) {
  return async function handleCreateNewSessionTool(args: Record<string, unknown>) {
    const ExecutorSessionID = normalizeString(args.ExecutorSessionID);
    const runtimeID = normalizeString(args.runtimeID);
    const instanceWorkspaceDirectory = normalizeString(args.instanceWorkspaceDirectory);
    const title = normalizeString(args.title) || undefined;
    const agent = normalizeString(args.agent) || undefined;
    const displayID = normalizeString(args.displayID) || undefined;
    const content = typeof args.content === "string" ? args.content : "";
    if (!ExecutorSessionID) throw new Error("ExecutorSessionID is required");

    await services.osg.requireOnlineRuntime(runtimeID);

    return services.osg.createNewSession({
      runtimeID,
      instanceWorkspaceDirectory,
      content,
      title,
      agent,
      displayID,
    });
  };
}
