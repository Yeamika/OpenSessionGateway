import { listMailboxItems } from "../mailbox.js";
import { normalizeList, normalizeStringArg } from "../common.js";
import type { SessionBridgeServices } from "../types.js";

export const LIST_MAILBOX_ITEMS_TOOL = {
  name: "ListMailboxItems",
  description: "Get mailbox items of current session",
  inputSchema: {
    type: "object",
    properties: {
      ExecutorSessionID: { type: "string", pattern: "\\S", description: "Executor sessionID" },
      size: { type: "number", description: "Maximum list size. Default: 10" },
      regex: { type: "string", description: "Regex filter on title and content" },
      metadataRegex: {
        type: "string",
        description: "Regex filter on time, InfoType, hasRead, senderSessionID, senderSessionTitle",
      },
    },
    required: ["ExecutorSessionID"],
    additionalProperties: false,
  },
};

export function createListMailboxItemsToolHandler(services: SessionBridgeServices) {
  return async function handleListMailboxItemsTool(toolArgs: Record<string, unknown>, callerRuntimeID: string) {
    const sessionID = normalizeStringArg(toolArgs.ExecutorSessionID);
    const size = normalizeList(toolArgs.size, 10);
    const regex = normalizeStringArg(toolArgs.regex) || undefined;
    const metadataRegex = normalizeStringArg(toolArgs.metadataRegex) || undefined;
    return listMailboxItems({
      services,
      runtimeID: callerRuntimeID,
      sessionID,
      size,
      regex,
      metadataRegex,
    });
  };
}
