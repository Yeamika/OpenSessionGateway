import { replayMailboxItem } from "@/lib/ClientModel/mailbox/store";
import { listRuntimeClients } from "@/lib/runtime-store";
import { normalizeStringArg } from "../common";

export const REPLAY_MAIL_TOOL = {
  name: "ReplayMail",
  description: "Reply by ReplayID (not ItemID)",
  inputSchema: {
    type: "object",
    properties: {
      ReplayID: { type: "string", description: "NeedReplay replay token" },
      msg: { type: "string", description: "Reply message" },
    },
    required: ["ReplayID", "msg"],
    additionalProperties: false,
  },
};

function currentCallerClient(runtimeID: string, clients: Array<{ runtimeID: string; sessionID: string | null; title: string | null }>) {
  return clients.find((item) => item.runtimeID === runtimeID) || null;
}

export async function handleReplayMailTool(toolArgs: Record<string, unknown>, callerRuntimeID: string) {
  const replayID = normalizeStringArg(toolArgs.ReplayID);
  const msg = normalizeStringArg(toolArgs.msg);
  if (!replayID) throw new Error("ReplayID is required");
  if (!msg) throw new Error("msg is required");

  const clients = await listRuntimeClients();
  const sender = currentCallerClient(callerRuntimeID, clients);
  if (!sender) throw new Error("caller runtime not found");

  return replayMailboxItem({
    runtimeID: callerRuntimeID,
    replayID,
    message: msg,
    senderSessionID: sender.sessionID || "",
    senderSessionTitle: sender.title || "",
  });
}
