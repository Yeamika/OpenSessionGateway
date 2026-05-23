import { normalizeString } from "../common.js";
import type { RuntimeControlServices } from "../types.js";

export const EXECUTE_SESSION_ACTION_TOOL = {
  name: "ExecuteSessionAction",
  description: "Execute one session action in a target runtime",
  inputSchema: {
    type: "object",
    properties: {
      runtimeID: { type: "string", pattern: "\\S", description: "Target client runtimeID" },
      sessionID: { type: "string", pattern: "\\S", description: "Target sessionID" },
      action: { type: "string", enum: ["abort", "compact"], description: "Session action to execute" },
      auto: { type: "boolean", description: "Optional auto compaction flag; only used when action=compact" },
    },
    required: ["runtimeID", "sessionID", "action"],
    additionalProperties: false,
  },
};

export function createExecuteSessionActionToolHandler(services: RuntimeControlServices) {
  return async function handleExecuteSessionActionTool(args: Record<string, unknown>) {
    const runtimeID = normalizeString(args.runtimeID);
    const sessionID = normalizeString(args.sessionID);
    const action = normalizeString(args.action);
    const auto = args.auto === true ? true : undefined;

    await services.osg.requireOnlineRuntimeSession(runtimeID, sessionID);

    if (action === "abort") {
      return services.osg.abortClientSession({ runtimeID, sessionID });
    }
    if (action === "compact") {
      return services.osg.compactSession({ runtimeID, sessionID, auto });
    }
    throw new Error("action must be abort or compact");
  };
}
