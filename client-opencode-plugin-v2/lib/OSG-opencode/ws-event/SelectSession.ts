import { createSelectSessionRequest } from "protocllibrary/ws-contract/SelectSession.js";

type QueryFactory = () => Record<string, unknown>;

export async function handleSelectSession(
  ctx: any,
  query: QueryFactory,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { sessionID, directory } = createSelectSessionRequest(payload);
  if (!sessionID) return { ok: false, error: "sessionID is required" };

  const runtimeQuery = {
    ...(query() || {}),
    ...(directory ? { directory } : {}),
  };

  const calls = [
    () => ctx?.client?.tui?.selectSession?.({ sessionID, directory }),
    () => ctx?.client?.tui?.selectSession?.({ body: { sessionID }, query: runtimeQuery }),
    () => ctx?.client?.tui?.selectSession?.({ sessionID }),
  ];

  let last: any = null;
  for (const call of calls) {
    const result = await Promise.resolve(call()).catch(() => null);
    if (result && !result.error) {
      return { ok: true, sessionID };
    }
    last = result;
  }

  return { ok: false, error: "select failed", details: last?.error || null, sessionID };
}
