import { replayMailboxItem } from "../mailbox.ts";
import { normalizeStringArg } from "../common.ts";
import type { SessionBridgeServices } from "../types.ts";

export const REPLY_MAILBOX_ITEM_TOOL = {
  name: "ReplyMailboxItem",
  description: "Reply by ReplayID (not ItemID)",
  inputSchema: {
    type: "object",
    properties: {
      ExecutorSessionID: { type: "string", pattern: "\\S", description: "Executor sessionID" },
      replayID: { type: "string", pattern: "\\S", description: "NeedReplay replay token" },
      msg: { type: "string", pattern: "\\S", description: "Reply message" },
    },
    required: ["ExecutorSessionID", "replayID", "msg"],
    additionalProperties: false,
  },
};

function currentCallerClient(
  runtimeID: string,
  clients: Array<{ runtimeID: string; sessionID: string | null; title: string | null }>,
) {
  return clients.find((item) => item.runtimeID === runtimeID) || null;
}

export function createReplyMailboxItemToolHandler(services: SessionBridgeServices) {
  return async function handleReplyMailboxItemTool(toolArgs: Record<string, unknown>, callerRuntimeID: string) {
    const sessionID = normalizeStringArg(toolArgs.ExecutorSessionID);
    const replayID = normalizeStringArg(toolArgs.replayID);
    const msg = normalizeStringArg(toolArgs.msg);
    const clients = await services.osg.listRuntimeClients();
    const sender = currentCallerClient(callerRuntimeID, clients);
    if (!sender) throw new Error("caller runtime not found");

    return replayMailboxItem({
      services,
      runtimeID: callerRuntimeID,
      sessionID,
      replayID,
      message: msg,
      senderSessionID: sender.sessionID || "",
      senderSessionTitle: sender.title || "",
    });
  };
}
