import { createCompactSessionRequest, readCompactSessionResponse } from "@opensessiongateway/protocol-library/ws-protocol/CompactSession.js";
import { resolveTargetSessionContext } from "../runtime/target-context.js";

function readModel(value: string) {
  const text = value.trim();
  if (!text) return null;
  const idx = text.indexOf("/");
  if (idx <= 0 || idx >= text.length - 1) return null;
  const providerID = text.slice(0, idx).trim();
  const modelID = text.slice(idx + 1).trim();
  if (!providerID || !modelID) return null;
  return { providerID, modelID };
}

export async function handleCompactSession(
  ctx: any,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const req = createCompactSessionRequest(payload);
  if (!req.sessionID) {
    return readCompactSessionResponse({ ok: false, sessionID: "", model: req.model, auto: req.auto, error: "sessionID is required" });
  }
  if (!req.model) {
    return readCompactSessionResponse({ ok: false, sessionID: req.sessionID, auto: req.auto, error: "model is required" });
  }

  const model = readModel(req.model);
  if (!model) {
    return readCompactSessionResponse({ ok: false, sessionID: req.sessionID, model: req.model, auto: req.auto, error: "model must be provider/model" });
  }

  const target = await resolveTargetSessionContext(ctx, req.sessionID);
  if (!target) {
    return readCompactSessionResponse({ ok: false, sessionID: req.sessionID, model: req.model, auto: req.auto, error: "target session context not found" });
  }

  const call = ctx?.client?.session?.summarize?.({
    path: { id: target.sessionID },
    query: { directory: target.instanceWorkspaceDirectory },
    body: {
      providerID: model.providerID,
      modelID: model.modelID,
      auto: req.auto === true,
    },
  });
  const result = await Promise.resolve(call).catch(() => null);

  if (!result || result.error || result.data !== true) {
    const err = result && typeof result === "object" && typeof result.error === "string"
      ? result.error
      : "compact session failed";
    return readCompactSessionResponse({
      ok: false,
      sessionID: target.sessionID,
      model: req.model,
      auto: req.auto,
      error: err,
    });
  }

  return readCompactSessionResponse({
    ok: true,
    sessionID: target.sessionID,
    model: req.model,
    auto: req.auto,
  });
}
