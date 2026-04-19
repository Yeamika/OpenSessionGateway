import { normalizeString } from "../common.js";
import type { RuntimeControlServices } from "../types.js";

export const COMPACT_SESSION_TOOL = {
  name: "CompactSession",
  description: "Trigger client-side session compaction with one model",
  inputSchema: {
    type: "object",
    properties: {
      runtimeID: { type: "string", pattern: "\\S", description: "Target client runtimeID" },
      sessionID: { type: "string", pattern: "\\S", description: "Target sessionID" },
      model: { type: "string", description: "Optional model in provider/model format" },
      auto: { type: "boolean", description: "Optional auto compaction flag" },
    },
    required: ["runtimeID", "sessionID"],
    additionalProperties: false,
  },
};

export function createCompactSessionToolHandler(services: RuntimeControlServices) {
  return async function handleCompactSessionTool(args: Record<string, unknown>) {
    const runtimeID = normalizeString(args.runtimeID);
    const sessionID = normalizeString(args.sessionID);
    const explicitModel = normalizeString(args.model) || undefined;
    const auto = args.auto === true ? true : undefined;

    await services.osg.requireOnlineRuntimeSession(runtimeID, sessionID);

    const model = explicitModel || (await services.osg.getSessionLastUsedModel({ runtimeID, sessionID })).id;
    if (!model) {
      throw new Error("model is required and no last used model was found");
    }

    return services.osg.compactSession({
      runtimeID,
      sessionID,
      model,
      auto,
    });
  };
}
