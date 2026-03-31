import { normalizeString } from "../common.ts";
import type { RuntimeControlServices } from "../types.ts";

export const SET_CLIENT_DISPLAY_SESSION_TOOL = {
  name: "SetClientDisplaySession",
  description: "Change displayed session on one runtime display",
  inputSchema: {
    type: "object",
    properties: {
      runtimeID: { type: "string", pattern: "\\S", description: "Target runtimeID" },
      displayID: { type: "string", pattern: "\\S", description: "Target displayID" },
      sessionID: { type: "string", pattern: "\\S", description: "Target sessionID" },
    },
    required: ["runtimeID", "displayID", "sessionID"],
    additionalProperties: false,
  },
};

export function createSetClientDisplaySessionToolHandler(services: RuntimeControlServices) {
  return async function handleSetClientDisplaySessionTool(args: Record<string, unknown>) {
    const runtimeID = normalizeString(args.runtimeID);
    const displayID = normalizeString(args.displayID);
    const sessionID = normalizeString(args.sessionID);

    await services.osg.requireOnlineRuntimeSession(runtimeID, sessionID);

    return services.osg.setClientDisplaySession({ runtimeID, displayID, sessionID });
  };
}
