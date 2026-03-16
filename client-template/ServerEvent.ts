import { listAvailableModels } from "./ws-event/ListAvailableModels.js";
import { abortSessionOfClient } from "./ws-event/AbortSessionOfClient.js";
import { getSessionMsg } from "./ws-event/GetSessionMsg.js";
import { listLastUsedModelOfSession } from "./ws-event/ListLastUsedModelOfSession.js";
import { getCurrentClientInfo } from "./ws-event/CurrentClientInfo.js";
import { renameSessionOfClient } from "./ws-event/RenameSessionOfClient.js";
import { listSession } from "./ws-event/SessionList.js";
import { selectSession } from "./ws-event/SelectSession.js";

function normalizeType(raw: unknown): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function handleServerEvent(message: unknown, runtimeID: string): Promise<unknown> {
  const src = message && typeof message === "object" ? (message as Record<string, unknown>) : {};
  const type = normalizeType(src.type);
  const payload = src.data && typeof src.data === "object" ? (src.data as Record<string, unknown>) : {};

  if (type === "requestcurrentinfo") {
    return getCurrentClientInfo();
  }
  if (type === "listsession") {
    return listSession();
  }

  if (type === "renamesessionofclient") {
    return renameSessionOfClient();
  }
  if (type === "selectsession") {
    return selectSession();
  }
  if (type === "abortsessionofclient") {
    const sessionID = typeof payload.sessionID === "string" ? payload.sessionID : "";
    return abortSessionOfClient(runtimeID, sessionID);
  }
  if (type === "listavailablemodels") {
    return listAvailableModels();
  }
  if (type === "listlastusedmodelofsession") {
    return listLastUsedModelOfSession(runtimeID);
  }
  if (type === "getsessionmsg") {
    const sessionID = typeof payload.sessionID === "string" ? payload.sessionID : "";
    return getSessionMsg(runtimeID, sessionID);
  }
  if (type === "addpromot") {
    return { accepted: true };
  }
  if (type === "servertoast") {
    return { accepted: true };
  }

  return { accepted: true };
}
