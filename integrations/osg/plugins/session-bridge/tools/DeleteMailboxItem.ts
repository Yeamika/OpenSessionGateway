import { deleteMailboxItem } from "../mailbox.js";
import { normalizeStringArg } from "../common.js";
import type { SessionBridgeServices } from "../types.js";

export const DELETE_MAILBOX_ITEM_TOOL = {
  name: "DeleteMailboxItem",
  description: "Delete one mailbox item by itemID",
  inputSchema: {
    type: "object",
    properties: {
      ExecutorSessionID: { type: "string", pattern: "\\S", description: "Executor sessionID" },
      itemID: { type: "string", pattern: "\\S", description: "Mailbox item id to delete" },
    },
    required: ["ExecutorSessionID", "itemID"],
    additionalProperties: false,
  },
};

export function createDeleteMailboxItemToolHandler(services: SessionBridgeServices) {
  return async function handleDeleteMailboxItemTool(toolArgs: Record<string, unknown>, callerRuntimeID: string) {
    const sessionID = normalizeStringArg(toolArgs.ExecutorSessionID);
    const itemID = normalizeStringArg(toolArgs.itemID);
    return deleteMailboxItem({
      services,
      runtimeID: callerRuntimeID,
      sessionID,
      itemID,
    });
  };
}
