import { createRenameSessionRequest } from "@opensessiongateway/protocol-library/ws-protocol/RenameSessionOfClient.js";
import { resolveTargetSessionContext } from "../runtime/target-context.js";

type QueryFactory = () => Record<string, unknown>;

export async function handleRenameSessionOfClient(
  ctx: any,
  _query: QueryFactory,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { sessionID, title } = createRenameSessionRequest(payload);
  if (!sessionID) return { ok: false, error: "sessionID is required" };
  if (!title) return { ok: false, error: "title is required" };

  const target = await resolveTargetSessionContext(ctx, sessionID);
  if (!target) return { ok: false, error: "target session context not found", sessionID, title };

  const result = await ctx?.client?.session?.update?.({
    path: { id: target.sessionID },
    query: { directory: target.instanceWorkspaceDirectory },
    body: { title },
  }).catch(() => null);

  if (!result || result.error) {
    return { ok: false, error: "rename failed", details: result?.error || null, sessionID, title };
  }

  return { ok: true, sessionID: target.sessionID, title };
}
