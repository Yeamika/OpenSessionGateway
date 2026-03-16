import { listMailboxItems } from "@/lib/ClientModel/mailbox/store";
import { normalizeList, normalizeStringArg } from "../common";

export const GET_MAILBOX_TOOL = {
  name: "GetMailbox",
  description: "Get mailbox items of current runtime",
  inputSchema: {
    type: "object",
    properties: {
      size: { type: "number", description: "Maximum list size. Default: 10" },
      regex: { type: "string", description: "Regex filter on title and content" },
      metadataRegex: {
        type: "string",
        description: "Regex filter on time, InfoType, hasRead, senderSessionID, senderSessionTitle",
      },
    },
    additionalProperties: false,
  },
};

export async function handleGetMailboxTool(toolArgs: Record<string, unknown>, callerRuntimeID: string) {
  const size = normalizeList(toolArgs.size, 10);
  const regex = normalizeStringArg(toolArgs.regex) || undefined;
  const metadataRegex = normalizeStringArg(toolArgs.metadataRegex) || undefined;
  return listMailboxItems({ runtimeID: callerRuntimeID, size, regex, metadataRegex });
}
