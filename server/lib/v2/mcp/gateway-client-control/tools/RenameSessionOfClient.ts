import { requireOnlineRuntimeSession } from "@/lib/runtime-validation";
import { requestRenameSessionOfClient } from "@/lib/v2/ws";

export const RENAME_SESSION_OF_CLIENT_TOOL = {
  name: "RenameSessionOfClient",
  description: "Rename one session in a target runtime",
  inputSchema: {
    type: "object",
    properties: {
      runtimeID: { type: "string", description: "Target client runtimeID" },
      sessionID: { type: "string", description: "Target sessionID" },
      title: { type: "string", description: "New session title" },
      directory: { type: "string", description: "Optional runtime directory" },
    },
    required: ["runtimeID", "sessionID", "title"],
    additionalProperties: false,
  },
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function handleRenameSessionOfClientTool(args: Record<string, unknown>) {
  const runtimeID = normalizeString(args.runtimeID);
  const sessionID = normalizeString(args.sessionID);
  const title = normalizeString(args.title);
  const directory = normalizeString(args.directory) || undefined;

  if (!runtimeID) throw new Error("runtimeID is required");
  if (!sessionID) throw new Error("sessionID is required");
  if (!title) throw new Error("title is required");
  await requireOnlineRuntimeSession(runtimeID, sessionID);

  return requestRenameSessionOfClient(runtimeID, sessionID, title, directory);
}
