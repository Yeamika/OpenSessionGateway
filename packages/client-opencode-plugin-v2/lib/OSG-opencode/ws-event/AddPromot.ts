import { createAddPromotRequest } from "@opensessiongateway/protocol-library/ws-protocol/AddPromot.js";
import { resolveTargetSessionContext } from "../runtime/target-context.js";

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

function readModel(
  value: string,
): { providerID: string; modelID: string } | undefined {
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
  _query: QueryFactory,
  _getCurrentClientInfo: () => Promise<CurrentInfo>,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const request = createAddPromotRequest({
    sessionID: readStringArg(payload, ["sessionID"]),
    msg: readStringArg(payload, ["msg"]),
    model: readStringArg(payload, ["model"]),
    system: readStringArg(payload, ["system"]),
  });
  const msg = request.msg;
  const payloadSessionID = request.sessionID;
  const modelRaw = request.model || "";
  const system = request.system || "";
  if (!msg) {
    return {
      ok: false,
      error: "msg is required",
      model: modelRaw || null,
      sessionID: "",
    };
  }

  if (!payloadSessionID) {
    return {
      ok: false,
      error: "sessionID is required",
      model: modelRaw || null,
      sessionID: "",
    };
  }

  const target = await resolveTargetSessionContext(ctx, payloadSessionID);
  if (!target) {
    return {
      ok: false,
      error: "target session context not found",
      model: modelRaw || null,
      sessionID: payloadSessionID,
    };
  }

  const model = readModel(modelRaw);
  const body = {
    parts: [{ type: "text", text: msg }],
    ...(system ? { system } : {}),
    ...(model ? { model } : {}),
  };

  const ok = await ctx?.client?.session
    ?.promptAsync?.({
      path: { id: target.sessionID },
      query: { directory: target.instanceWorkspaceDirectory },
      body,
    })
    .then(() => true)
    .catch(() => false);

  return {
    ok,
    model: modelRaw || null,
    sessionID: target.sessionID,
    ...(ok ? {} : { error: "prompt submit failed" }),
  };
}
