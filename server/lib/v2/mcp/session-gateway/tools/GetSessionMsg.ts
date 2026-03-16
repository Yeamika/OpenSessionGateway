import { requireOnlineRuntimeSession } from "@/lib/runtime-validation";
import { requestGetSessionMsg } from "@/lib/v2/ws";
import { normalizeList, normalizeStringArg } from "../common";

export const GET_SESSION_MSG_TOOL = {
  name: "GetSessionMsg",
  description: "Get recent messages of one session from target runtime",
  inputSchema: {
    type: "object",
    properties: {
      runtimeID: { type: "string", description: "Target runtimeID" },
      sessionID: { type: "string", description: "Target sessionID" },
      size: { type: "number", description: "Maximum messages to return. Default: 10" },
      regex: { type: "string", description: "Regex search on message content. Default: empty" },
    },
    required: ["runtimeID", "sessionID"],
    additionalProperties: false,
  },
};

export async function handleGetSessionMsgTool(toolArgs: Record<string, unknown>) {
  const targetRuntimeID = normalizeStringArg(toolArgs.runtimeID);
  const sessionID = normalizeStringArg(toolArgs.sessionID);
  const size = normalizeList(toolArgs.size, 10);
  const regex = normalizeStringArg(toolArgs.regex) || undefined;

  if (!targetRuntimeID) throw new Error("runtimeID is required");
  if (!sessionID) throw new Error("sessionID is required");

  await requireOnlineRuntimeSession(targetRuntimeID, sessionID);
  return requestGetSessionMsg(targetRuntimeID, sessionID, size, regex);
}
