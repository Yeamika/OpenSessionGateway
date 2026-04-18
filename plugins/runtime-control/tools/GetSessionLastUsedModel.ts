import { normalizeString } from "../common.js";
import type { RuntimeControlServices } from "../types.js";

export const GET_SESSION_LAST_USED_MODEL_TOOL = {
  name: "GetSessionLastUsedModel",
  description: "Read last used model of one session",
  inputSchema: {
    type: "object",
    properties: {
      runtimeID: { type: "string", pattern: "\\S", description: "Target client runtimeID" },
      sessionID: { type: "string", pattern: "\\S", description: "Target sessionID" },
    },
    required: ["runtimeID", "sessionID"],
    additionalProperties: false,
  },
};

export function createGetSessionLastUsedModelToolHandler(services: RuntimeControlServices) {
  return async function handleGetSessionLastUsedModelTool(args: Record<string, unknown>) {
    const runtimeID = normalizeString(args.runtimeID);
    const sessionID = normalizeString(args.sessionID);

    await services.osg.requireOnlineRuntimeSession(runtimeID, sessionID);

    return services.osg.getSessionLastUsedModel({ runtimeID, sessionID });
  };
}
