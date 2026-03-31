import { createAbortSessionRequest } from "@opensessiongateway/protocol-library/ws-protocol/AbortSessionOfClient.js";
import { resolveTargetSessionContext } from "../runtime/target-context.js";

type QueryFactory = () => Record<string, unknown>;

export async function handleAbortSessionOfClient(
  ctx: any,
  _query: QueryFactory,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { sessionID } = createAbortSessionRequest(payload);
  if (!sessionID) return { ok: false, aborted: false, sessionID: "", error: "sessionID is required" };

  const target = await resolveTargetSessionContext(ctx, sessionID);
  if (!target) {
    return { ok: false, aborted: false, sessionID, error: "target session context not found" };
  }

  const result = await ctx?.client?.session?.abort?.({
    path: { id: target.sessionID },
    query: { directory: target.instanceWorkspaceDirectory },
  }).catch(() => null);

  if (!result || result.error) {
    return { ok: false, aborted: false, sessionID, error: "abort failed", details: result?.error || null };
  }

  return {
    ok: true,
    aborted: result.data === true,
    sessionID: target.sessionID,
  };
}
