import { requireOnlineRuntimeSession } from "@/lib/runtime-validation";
import { requestAbortSessionOfClient } from "@/lib/v2/ws";

export const ABORT_SESSION_OF_CLIENT_TOOL = {
  name: "AbortSessionOfClient",
  description: "Abort one session in a target runtime",
  inputSchema: {
    type: "object",
    properties: {
      runtimeID: { type: "string", description: "Target client runtimeID" },
      sessionID: { type: "string", description: "Target sessionID" },
    },
    required: ["runtimeID", "sessionID"],
    additionalProperties: false,
  },
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function handleAbortSessionOfClientTool(args: Record<string, unknown>) {
  const runtimeID = normalizeString(args.runtimeID);
  const sessionID = normalizeString(args.sessionID);

  if (!runtimeID) throw new Error("runtimeID is required");
  if (!sessionID) throw new Error("sessionID is required");
  await requireOnlineRuntimeSession(runtimeID, sessionID);

  return requestAbortSessionOfClient(runtimeID, sessionID);
}
