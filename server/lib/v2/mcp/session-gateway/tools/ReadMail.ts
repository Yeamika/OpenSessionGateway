import { markMailboxRead } from "@/lib/ClientModel/mailbox/store";
import { normalizeStringArg } from "../common";

export const READ_MAIL_TOOL = {
  name: "ReadMail",
  description: "Mark one mailbox item as read and return full content",
  inputSchema: {
    type: "object",
    properties: {
      ItemId: { type: "string", description: "Mailbox item id" },
    },
    required: ["ItemId"],
    additionalProperties: false,
  },
};

export async function handleReadMailTool(toolArgs: Record<string, unknown>, callerRuntimeID: string) {
  const itemID = normalizeStringArg(toolArgs.ItemId);
  if (!itemID) throw new Error("ItemId is required");
  const row = await markMailboxRead({ runtimeID: callerRuntimeID, itemID });
  return {
    ok: Boolean(row),
    ItemId: itemID,
    mail: row,
  };
}
