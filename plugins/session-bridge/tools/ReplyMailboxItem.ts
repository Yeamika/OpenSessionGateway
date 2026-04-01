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

function findRuntimeSessionClient(
  runtimeID: string,
  sessionID: string,
  clients: Array<{ runtimeID: string; sessionID: string | null; title: string | null }>,
) {
  return clients.find((item) => item.runtimeID === runtimeID && item.sessionID === sessionID) || null;
}

export function createReplyMailboxItemToolHandler(services: SessionBridgeServices) {
  return async function handleReplyMailboxItemTool(toolArgs: Record<string, unknown>, executorRuntimeID: string) {
    const executorSessionID = normalizeStringArg(toolArgs.ExecutorSessionID);
    const replayID = normalizeStringArg(toolArgs.replayID);
    const msg = normalizeStringArg(toolArgs.msg);
    const clients = await services.osg.listRuntimeClients();
    const sender = findRuntimeSessionClient(executorRuntimeID, executorSessionID, clients);
    if (!sender) throw new Error("executor runtime/session not found");

    return replayMailboxItem({
      services,
      runtimeID: executorRuntimeID,
      sessionID: executorSessionID,
      replayID,
      message: msg,
      senderSessionID: executorSessionID,
      senderSessionTitle: sender.title || "",
    });
  };
}
