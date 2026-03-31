import { sendMailboxItem } from "../mailbox.ts";
import { normalizeStringArg } from "../common.ts";
import type { SessionBridgeServices } from "../types.ts";

export const SEND_MAILBOX_ITEM_TOOL = {
  name: "SendMailboxItem",
  description: "Send a mail to target runtime mailbox",
  inputSchema: {
    type: "object",
    properties: {
      runtimeID: { type: "string", pattern: "\\S", description: "Target runtimeID" },
      sessionID: { type: "string", pattern: "\\S", description: "Target sessionID" },
      title: { type: "string", pattern: "\\S", description: "Mail title" },
      msg: { type: "string", pattern: "\\S", description: "Mail message" },
      type: { type: "string", enum: ["Notice", "NeedReplay"], description: "Notice(default) or NeedReplay" },
    },
    required: ["runtimeID", "sessionID", "title", "msg"],
    additionalProperties: false,
  },
};

function currentCallerClient(
  runtimeID: string,
  clients: Array<{ runtimeID: string; sessionID: string | null; title: string | null }>,
) {
  return clients.find((item) => item.runtimeID === runtimeID) || null;
}

export function createSendMailboxItemToolHandler(services: SessionBridgeServices) {
  return async function handleSendMailboxItemTool(toolArgs: Record<string, unknown>, callerRuntimeID: string) {
    const targetRuntimeID = normalizeStringArg(toolArgs.runtimeID);
    const targetSessionID = normalizeStringArg(toolArgs.sessionID);
    const title = normalizeStringArg(toolArgs.title);
    const msg = normalizeStringArg(toolArgs.msg);
    const typeRaw = normalizeStringArg(toolArgs.type);
    const type = !typeRaw ? "Notice" : typeRaw;

    await services.osg.requireOnlineRuntimeSession(targetRuntimeID, targetSessionID);
    const clients = await services.osg.listRuntimeClients();
    const sender = currentCallerClient(callerRuntimeID, clients);
    if (!sender) throw new Error("caller runtime not found");

    const itemID = await sendMailboxItem({
      services,
      recipientRuntimeID: targetRuntimeID,
      recipientSessionID: targetSessionID,
      senderRuntimeID: callerRuntimeID,
      senderSessionID: sender.sessionID || "",
      senderSessionTitle: sender.title || "",
      title,
      message: msg,
      mailType: type === "NeedReplay" ? "NeedReplay" : "Notice",
    });
    return { ok: true, itemID };
  };
}
