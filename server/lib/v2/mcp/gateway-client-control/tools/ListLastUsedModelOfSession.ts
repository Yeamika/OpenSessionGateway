import { requireOnlineRuntimeSession } from "@/lib/runtime-validation";
import { requestLastUsedModelOfSession } from "@/lib/v2/ws";

export const LIST_LAST_USED_MODEL_OF_SESSION_TOOL = {
  name: "ListLastUsedModelOfSession",
  description: "Read last used model of one session",
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

export async function handleListLastUsedModelOfSessionTool(args: Record<string, unknown>) {
  const runtimeID = normalizeString(args.runtimeID);
  const sessionID = normalizeString(args.sessionID);

  if (!runtimeID) throw new Error("runtimeID is required");
  if (!sessionID) throw new Error("sessionID is required");
  await requireOnlineRuntimeSession(runtimeID, sessionID);

  return requestLastUsedModelOfSession(runtimeID, sessionID);
}
