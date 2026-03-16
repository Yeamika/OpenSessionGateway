import { addOneShotTimer } from "@/lib/ClientModel/timer/store";
import { requireOnlineRuntimeSession } from "@/lib/runtime-validation";
import { normalizePositiveInt, normalizeStringArg } from "../common";

export const ADD_ONE_SHOT_TIMER_TOOL = {
  name: "AddOneShotTimer",
  description: "Add one-shot timer to runtime/session",
  inputSchema: {
    type: "object",
    properties: {
      RuntimeID: { type: "string", description: "Target runtimeID" },
      SessionID: { type: "string", description: "Target sessionID" },
      Title: { type: "string", description: "Optional title, default: 定时任务" },
      MSG: { type: "string", description: "Timer message" },
      AfterSeconds: { type: "number", description: "Trigger after N seconds" },
    },
    required: ["RuntimeID", "SessionID", "MSG", "AfterSeconds"],
    additionalProperties: false,
  },
};

export async function handleAddOneShotTimerTool(toolArgs: Record<string, unknown>) {
  const runtimeID = normalizeStringArg(toolArgs.RuntimeID);
  const sessionID = normalizeStringArg(toolArgs.SessionID);
  const title = normalizeStringArg(toolArgs.Title) || "定时任务";
  const msg = normalizeStringArg(toolArgs.MSG);
  const afterSeconds = normalizePositiveInt(toolArgs.AfterSeconds, "AfterSeconds");

  if (!runtimeID) throw new Error("RuntimeID is required");
  if (!sessionID) throw new Error("SessionID is required");
  if (!msg) throw new Error("MSG is required");
  await requireOnlineRuntimeSession(runtimeID, sessionID);

  return addOneShotTimer({
    runtimeID,
    sessionID,
    title,
    msg,
    delaySeconds: afterSeconds,
  });
}
