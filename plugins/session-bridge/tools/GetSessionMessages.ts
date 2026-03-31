import { normalizeList, normalizeStringArg } from "../common.ts";
import type { SessionBridgeServices } from "../types.ts";

export const GET_SESSION_MESSAGES_TOOL = {
  name: "GetSessionMessages",
  description: "Get recent messages of one session from target runtime",
  inputSchema: {
    type: "object",
    properties: {
      runtimeID: { type: "string", pattern: "\\S", description: "Target runtimeID" },
      sessionID: { type: "string", pattern: "\\S", description: "Target sessionID" },
      size: { type: "number", description: "Maximum messages to return. Default: 10" },
      regex: { type: "string", description: "Regex search on message content. Default: empty" },
    },
    required: ["runtimeID", "sessionID"],
    additionalProperties: false,
  },
};

export function createGetSessionMessagesToolHandler(services: SessionBridgeServices) {
  return async function handleGetSessionMessagesTool(toolArgs: Record<string, unknown>) {
    const targetRuntimeID = normalizeStringArg(toolArgs.runtimeID);
    const sessionID = normalizeStringArg(toolArgs.sessionID);
    const size = normalizeList(toolArgs.size, 10);
    const regex = normalizeStringArg(toolArgs.regex) || undefined;

    return services.osg.getSessionMessages({
      runtimeID: targetRuntimeID,
      sessionID,
      size,
      regex,
    });
  };
}
