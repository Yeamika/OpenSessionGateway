import { sendMailboxItem } from "@/lib/ClientModel/mailbox/store";
import { listRuntimeClients } from "@/lib/runtime-store";
import { requireOnlineRuntimeSession } from "@/lib/runtime-validation";
import { normalizeStringArg } from "../common";

export const SEND_MAIL_TOOL = {
  name: "SendMail",
  description: "Send a mail to target runtime mailbox",
  inputSchema: {
    type: "object",
    properties: {
      RuntimeId: { type: "string", description: "Target runtimeID" },
      SessionId: { type: "string", description: "Target sessionID" },
      title: { type: "string", description: "Mail title" },
      msg: { type: "string", description: "Mail message" },
      TYPE: { type: "string", description: "Notice(default) or NeedReplay" },
    },
    required: ["RuntimeId", "SessionId", "title", "msg"],
    additionalProperties: false,
  },
};

function currentCallerClient(runtimeID: string, clients: Array<{ runtimeID: string; sessionID: string | null; title: string | null }>) {
  return clients.find((item) => item.runtimeID === runtimeID) || null;
}

export async function handleSendMailTool(toolArgs: Record<string, unknown>, callerRuntimeID: string) {
  const targetRuntimeID = normalizeStringArg(toolArgs.RuntimeId);
  const targetSessionID = normalizeStringArg(toolArgs.SessionId);
  const title = normalizeStringArg(toolArgs.title);
  const msg = normalizeStringArg(toolArgs.msg);
  const typeRaw = normalizeStringArg(toolArgs.TYPE);
  const type = !typeRaw ? "Notice" : typeRaw;

  if (!targetRuntimeID) throw new Error("RuntimeId is required");
  if (!targetSessionID) throw new Error("SessionId is required");
  if (!title) throw new Error("title is required");
  if (!msg) throw new Error("msg is required");
  if (type !== "Notice" && type !== "NeedReplay") {
    throw new Error("TYPE must be Notice or NeedReplay");
  }

  await requireOnlineRuntimeSession(targetRuntimeID, targetSessionID);
  const clients = await listRuntimeClients();
  const sender = currentCallerClient(callerRuntimeID, clients);
  if (!sender) throw new Error("caller runtime not found");

  const itemID = await sendMailboxItem({
    recipientRuntimeID: targetRuntimeID,
    recipientSessionID: targetSessionID,
    senderRuntimeID: callerRuntimeID,
    senderSessionID: sender.sessionID || "",
    senderSessionTitle: sender.title || "",
    title,
    message: msg,
    mailType: type as "Notice" | "NeedReplay",
  });
  return { ok: true, ItemID: itemID };
}
