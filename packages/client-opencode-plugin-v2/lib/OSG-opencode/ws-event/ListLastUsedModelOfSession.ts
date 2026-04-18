import type { LastUsedModelOfSessionResponse } from "@opensessiongateway/protocol-library/ws-protocol/ListLastUsedModelOfSession.js";
import { resolveTargetSessionContext } from "../runtime/target-context.js";

type QueryFactory = () => Record<string, unknown>;

function readStringArg(src: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = src[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function readModelFromMessage(msg: unknown): { providerID: string; modelID: string; id: string; time: string } | null {
  if (!msg || typeof msg !== "object") return null;
  const src = msg as Record<string, unknown>;
  const info = src.info && typeof src.info === "object" ? (src.info as Record<string, unknown>) : {};
  const role = typeof info.role === "string" ? info.role.trim() : "";

  let providerID = "";
  let modelID = "";

  if (role === "assistant") {
    providerID = typeof info.providerID === "string" ? info.providerID.trim() : "";
    modelID = typeof info.modelID === "string" ? info.modelID.trim() : "";
  } else if (role === "user") {
    const model = info.model && typeof info.model === "object" ? (info.model as Record<string, unknown>) : {};
    providerID = typeof model.providerID === "string" ? model.providerID.trim() : "";
    modelID = typeof model.modelID === "string" ? model.modelID.trim() : "";
  }

  if (!providerID || !modelID) return null;

  const time =
    (typeof src.createdAt === "string" && src.createdAt.trim()) ||
    (typeof src.updatedAt === "string" && src.updatedAt.trim()) ||
    (src.time && typeof src.time === "object" && typeof (src.time as Record<string, unknown>).created === "string"
      ? String((src.time as Record<string, unknown>).created).trim()
      : "") ||
    "";

  return {
    providerID,
    modelID,
    id: `${providerID}/${modelID}`,
    time,
  };
}

export async function handleListLastUsedModelOfSession(
  ctx: any,
  _query: QueryFactory,
  runtimeID: string,
  payload: Record<string, unknown>,
): Promise<LastUsedModelOfSessionResponse | (LastUsedModelOfSessionResponse & { error: string })> {
  const sessionID = readStringArg(payload, ["sessionID"]);
  if (!sessionID) {
      return { runtimeID, sessionID: "", providerID: "", modelID: "", id: "", time: "", error: "sessionID is required" };
  }

  const target = await resolveTargetSessionContext(ctx, sessionID);
  if (!target) {
    return { runtimeID, sessionID, providerID: "", modelID: "", id: "", time: "", error: "target session context not found" };
  }

  const result = await ctx?.client?.session?.messages?.({
    path: { id: target.sessionID },
    query: {
      directory: target.instanceWorkspaceDirectory,
      limit: 50,
    },
  }).catch(() => null);

  const messages = Array.isArray(result?.data) ? result.data : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const model = readModelFromMessage(messages[i]);
    if (!model) continue;
    return {
      runtimeID,
      sessionID: target.sessionID,
      providerID: model.providerID,
      modelID: model.modelID,
      id: model.id,
      time: model.time,
    };
  }

  return {
    runtimeID,
    sessionID: target.sessionID,
    providerID: "",
    modelID: "",
    id: "",
    time: "",
  };
}
