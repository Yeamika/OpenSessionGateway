import { listRuntimeTimers } from "@/lib/ClientModel/timer/store";
import { requireOnlineRuntimeSession } from "@/lib/runtime-validation";
import { normalizeStringArg } from "../common";

export const LIST_RUNTIME_TIMERS_TOOL = {
  name: "ListRuntimeTimers",
  description: "List timers under runtime/session",
  inputSchema: {
    type: "object",
    properties: {
      RuntimeID: { type: "string", description: "Target runtimeID" },
      SessionID: { type: "string", description: "Target sessionID" },
    },
    required: ["RuntimeID", "SessionID"],
    additionalProperties: false,
  },
};

export async function handleListRuntimeTimersTool(toolArgs: Record<string, unknown>) {
  const runtimeID = normalizeStringArg(toolArgs.RuntimeID);
  const sessionID = normalizeStringArg(toolArgs.SessionID);

  if (!runtimeID) throw new Error("RuntimeID is required");
  if (!sessionID) throw new Error("SessionID is required");
  await requireOnlineRuntimeSession(runtimeID, sessionID);
  return listRuntimeTimers({ runtimeID, sessionID });
}
