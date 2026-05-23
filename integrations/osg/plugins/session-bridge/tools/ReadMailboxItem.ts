import { markMailboxRead } from "../mailbox.js";
import { normalizeStringArg } from "../common.js";
import type { SessionBridgeServices } from "../types.js";

export const READ_MAILBOX_ITEM_TOOL = {
  name: "ReadMailboxItem",
  description: "Mark one mailbox item as read and return full content",
  inputSchema: {
    type: "object",
    properties: {
      ExecutorSessionID: { type: "string", pattern: "\\S", description: "Executor sessionID" },
      itemID: { type: "string", pattern: "\\S", description: "Mailbox item id" },
    },
    required: ["ExecutorSessionID", "itemID"],
    additionalProperties: false,
  },
};

export function createReadMailboxItemToolHandler(services: SessionBridgeServices) {
  return async function handleReadMailboxItemTool(toolArgs: Record<string, unknown>, callerRuntimeID: string) {
    const sessionID = normalizeStringArg(toolArgs.ExecutorSessionID);
    const itemID = normalizeStringArg(toolArgs.itemID);
    const row = await markMailboxRead({
      services,
      runtimeID: callerRuntimeID,
      sessionID,
      itemID,
    });
    return {
      ok: Boolean(row),
      itemID,
      mail: row,
    };
  };
}
