import { requireOnlineRuntimeSession } from "@/lib/runtime-validation";
import { requestSelectSession } from "@/lib/v2/ws";

export const SELECT_SESSION_TOOL = {
  name: "SelectSession",
  description: "Select one session in a target runtime",
  inputSchema: {
    type: "object",
    properties: {
      runtimeID: { type: "string", description: "Target client runtimeID" },
      sessionID: { type: "string", description: "Target sessionID" },
      directory: { type: "string", description: "Optional runtime directory" },
    },
    required: ["runtimeID", "sessionID"],
    additionalProperties: false,
  },
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function handleSelectSessionTool(args: Record<string, unknown>) {
  const runtimeID = normalizeString(args.runtimeID);
  const sessionID = normalizeString(args.sessionID);
  const directory = normalizeString(args.directory) || undefined;

  if (!runtimeID) throw new Error("runtimeID is required");
  if (!sessionID) throw new Error("sessionID is required");
  await requireOnlineRuntimeSession(runtimeID, sessionID);

  return requestSelectSession(runtimeID, sessionID, directory);
}
