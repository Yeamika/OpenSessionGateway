import { normalizeString } from "../common.js";
import type { RuntimeControlServices } from "../types.js";

export const REQUEST_RUNTIME_TOOL = {
  name: "RequestRuntime",
  description: "Probe one runtime target and force a content refresh before returning status",
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

export function createRequestRuntimeToolHandler(services: RuntimeControlServices) {
  return async function handleRequestRuntimeTool(args: Record<string, unknown>) {
    const runtimeID = normalizeString(args.runtimeID);
    const sessionID = normalizeString(args.sessionID);
    if (!sessionID) throw new Error("sessionID is required");
    await services.osg.requireOnlineRuntime(runtimeID);
    return services.osg.requestRuntime({ runtimeID, sessionID });
  };
}
