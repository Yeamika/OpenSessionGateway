import { createSetClientDisplaySessionRequest } from "@opensessiongateway/protocol-library/ws-protocol/SetClientDisplaySession.js";

type QueryFactory = () => Record<string, unknown>;

async function selectSessionViaSdk(
  ctx: any,
  payload: { displayID: string; sessionID: string },
): Promise<Record<string, unknown> | boolean | null> {
  const fn = ctx?.client?.tui?.selectSession;
  if (typeof fn !== "function") return null;
  return Promise.resolve(fn(payload)).catch((error) => ({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }));
}

export async function handleSetClientDisplaySession(
  ctx: any,
  query: QueryFactory,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const req = createSetClientDisplaySessionRequest(payload);
  if (!req.displayID) return { ok: false, error: "displayID is required" };
  if (!req.sessionID) return { ok: false, error: "sessionID is required", displayID: req.displayID };

  const sdkResult = await selectSessionViaSdk(ctx, {
    displayID: req.displayID,
    sessionID: req.sessionID,
  });

  if (sdkResult === true || (sdkResult && typeof sdkResult === "object" && !("error" in sdkResult))) {
    return { ok: true, displayID: req.displayID, sessionID: req.sessionID };
  }

  return {
    ok: false,
    error: "set display session failed",
    details:
      (sdkResult && typeof sdkResult === "object" && "error" in sdkResult ? sdkResult.error : null)
      || null,
    displayID: req.displayID,
    sessionID: req.sessionID,
  };
}
