import { createRenameSessionRequest } from "protocllibrary/ws-contract/RenameSessionOfClient.js";

type QueryFactory = () => Record<string, unknown>;

export async function handleRenameSessionOfClient(
  ctx: any,
  query: QueryFactory,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { sessionID, title, directory } = createRenameSessionRequest(payload);
  if (!sessionID) return { ok: false, error: "sessionID is required" };
  if (!title) return { ok: false, error: "title is required" };

  const runtimeQuery = {
    ...(query() || {}),
    ...(directory ? { directory } : {}),
  };

  const result = await ctx?.client?.session?.update?.({
    path: { id: sessionID },
    query: runtimeQuery,
    body: { title },
  }).catch(() => null);

  if (!result || result.error) {
    return { ok: false, error: "rename failed", details: result?.error || null, sessionID, title };
  }

  return { ok: true, sessionID, title };
}
