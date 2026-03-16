import { listRuntimeClients } from "@/lib/runtime-store";
import { requireOnlineRuntimeSession } from "@/lib/runtime-validation";
import { requestAddPromot } from "@/lib/v2/ws";
import { normalizeStringArg } from "../common";

export const ADD_PROMOT_TOOL = {
  name: "AddPromot",
  description: "Send wrapped session-gateway message to target runtime/session",
  inputSchema: {
    type: "object",
    properties: {
      runtimeID: { type: "string", description: "Target runtimeID" },
      sessionID: { type: "string", description: "Target sessionID" },
      msg: { type: "string", description: "True message content" },
    },
    required: ["runtimeID", "sessionID", "msg"],
    additionalProperties: false,
  },
};

function currentCallerClient(runtimeID: string, clients: Array<{ runtimeID: string; sessionID: string | null; title: string | null }>) {
  return clients.find((item) => item.runtimeID === runtimeID) || null;
}

function wrapSessionGatewayMsg(input: {
  senderRuntimeID: string;
  senderSessionID: string;
  senderSessionTitle: string;
  msg: string;
}): string {
  return [
    "<SessionGatewayMsg>",
    "<metadata>",
    `<SenderRuntimeID>${input.senderRuntimeID}</SenderRuntimeID>`,
    `<SenderSessionID>${input.senderSessionID}</SenderSessionID>`,
    `<SenderSessionTitle>${input.senderSessionTitle}</SenderSessionTitle>`,
    "</metadata>",
    "<msg>",
    input.msg,
    "</msg>",
    "</SessionGatewayMsg>",
  ].join("\n");
}

export async function handleAddPromotTool(toolArgs: Record<string, unknown>, callerRuntimeID: string) {
  const targetRuntimeID = normalizeStringArg(toolArgs.runtimeID);
  const targetSessionID = normalizeStringArg(toolArgs.sessionID);
  const msg = normalizeStringArg(toolArgs.msg);

  if (!targetRuntimeID) throw new Error("runtimeID is required");
  if (!targetSessionID) throw new Error("sessionID is required");
  if (!msg) throw new Error("msg is required");

  await requireOnlineRuntimeSession(targetRuntimeID, targetSessionID);

  const clients = await listRuntimeClients();
  const sender = currentCallerClient(callerRuntimeID, clients);
  if (!sender) throw new Error("caller runtime not found");

  const wrapped = wrapSessionGatewayMsg({
    senderRuntimeID: callerRuntimeID,
    senderSessionID: sender.sessionID || "",
    senderSessionTitle: sender.title || "",
    msg,
  });

  const response = await requestAddPromot(targetRuntimeID, targetSessionID, wrapped);
  return {
    ...response,
    runtimeID: targetRuntimeID,
    sessionID: targetSessionID,
  };
}
