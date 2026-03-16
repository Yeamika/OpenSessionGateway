import { createAbortSessionRequest } from "protocllibrary/ws-contract/AbortSessionOfClient.js";

type QueryFactory = () => Record<string, unknown>;

export async function handleAbortSessionOfClient(
  ctx: any,
  query: QueryFactory,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { sessionID } = createAbortSessionRequest(payload);
  if (!sessionID) return { ok: false, aborted: false, sessionID: "", error: "sessionID is required" };

  const runtimeQuery = query() || {};

  const result = await ctx?.client?.session?.abort?.({
    path: { sessionID },
    query: runtimeQuery,
  }).catch(() => null);

  if (!result || result.error) {
    return { ok: false, aborted: false, sessionID, error: "abort failed", details: result?.error || null };
  }

  return {
    ok: true,
    aborted: result.data === true,
    sessionID,
  };
}
