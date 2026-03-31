import { normalizeString } from "../common.ts";
import type { RuntimeControlServices } from "../types.ts";

export const ABORT_CLIENT_SESSION_TOOL = {
  name: "AbortClientSession",
  description: "Abort one session in a target runtime",
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

export function createAbortClientSessionToolHandler(services: RuntimeControlServices) {
  return async function handleAbortClientSessionTool(args: Record<string, unknown>) {
    const runtimeID = normalizeString(args.runtimeID);
    const sessionID = normalizeString(args.sessionID);

    await services.osg.requireOnlineRuntimeSession(runtimeID, sessionID);

    return services.osg.abortClientSession({ runtimeID, sessionID });
  };
}
