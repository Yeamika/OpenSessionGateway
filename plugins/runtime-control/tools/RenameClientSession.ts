import { normalizeString } from "../common.js";
import type { RuntimeControlServices } from "../types.js";

export const RENAME_CLIENT_SESSION_TOOL = {
  name: "RenameClientSession",
  description: "Rename one session in a target runtime",
  inputSchema: {
    type: "object",
    properties: {
      runtimeID: { type: "string", pattern: "\\S", description: "Target client runtimeID" },
      sessionID: { type: "string", pattern: "\\S", description: "Target sessionID" },
      title: { type: "string", pattern: "\\S", description: "New session title" },
    },
    required: ["runtimeID", "sessionID", "title"],
    additionalProperties: false,
  },
};

export function createRenameClientSessionToolHandler(services: RuntimeControlServices) {
  return async function handleRenameClientSessionTool(args: Record<string, unknown>) {
    const runtimeID = normalizeString(args.runtimeID);
    const sessionID = normalizeString(args.sessionID);
    const title = normalizeString(args.title);

    await services.osg.requireOnlineRuntimeSession(runtimeID, sessionID);

    return services.osg.renameClientSession({ runtimeID, sessionID, title });
  };
}
