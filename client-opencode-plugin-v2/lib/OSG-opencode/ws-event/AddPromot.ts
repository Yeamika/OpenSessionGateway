import { createAddPromotRequest, normalizeAddPromotRole, type AddPromotRole } from "protocllibrary/ws-contract/AddPromot.js";

type QueryFactory = () => Record<string, unknown>;

type CurrentInfo = {
  sessionID?: string;
};

function readStringArg(src: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = src[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function readModel(value: string): { providerID: string; modelID: string } | undefined {
  const text = value.trim();
  if (!text) return undefined;
  const idx = text.indexOf("/");
  if (idx <= 0 || idx >= text.length - 1) return undefined;
  const providerID = text.slice(0, idx).trim();
  const modelID = text.slice(idx + 1).trim();
  if (!providerID || !modelID) return undefined;
  return { providerID, modelID };
}

export async function handleAddPromot(
  ctx: any,
  query: QueryFactory,
  getCurrentClientInfo: () => Promise<CurrentInfo>,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const request = createAddPromotRequest({
    sessionID: readStringArg(payload, ["sessionID"]),
    msg: readStringArg(payload, ["msg"]),
    model: readStringArg(payload, ["model"]),
    role: readStringArg(payload, ["role"]),
  });
  const msg = request.msg;
  const payloadSessionID = request.sessionID;
  const role: AddPromotRole = normalizeAddPromotRole(request.role || "user");
  const modelRaw = request.model || "";
  if (!msg) {
    return { ok: false, error: "msg is required", role, model: modelRaw || null, sessionID: "" };
  }

  let sessionID = payloadSessionID;
  if (!sessionID) {
    const info = await getCurrentClientInfo();
    sessionID = typeof info?.sessionID === "string" ? info.sessionID.trim() : "";
  }
  if (!sessionID) {
    return { ok: false, error: "current sessionID not found", role, model: modelRaw || null, sessionID: "" };
  }

  const model = readModel(modelRaw);
  const body = {
    parts: [{ type: "text", text: msg }],
    ...(role === "system" ? { system: msg } : {}),
    ...(model ? { model } : {}),
  };

  const result = await ctx?.client?.session?.promptAsync?.({
    path: { id: sessionID },
    query: query(),
    body,
  }).catch(() => null);

  const ok = Boolean(result && !result.error);
  return {
    ok,
    role,
    model: modelRaw || null,
    sessionID,
    ...(ok ? {} : { error: "prompt submit failed" }),
  };
}
