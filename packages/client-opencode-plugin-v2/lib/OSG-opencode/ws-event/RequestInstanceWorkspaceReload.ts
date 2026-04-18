type QueryFactory = () => Record<string, unknown>;
import { resolveTargetInstanceWorkspaceContext } from "../runtime/target-context.js";

function readStringArg(src: Record<string, unknown>, key: string): string {
  const value = src[key];
  return typeof value === "string" ? value.trim() : "";
}

export async function handleRequestInstanceWorkspaceReload(
  _ctx: any,
  _query: QueryFactory,
  payload: Record<string, unknown>,
  requestInstanceWorkspaceReload: (input?: { instanceWorkspaceDirectory?: string; title?: string }) => Promise<unknown>,
): Promise<unknown> {
  return requestInstanceWorkspaceReload({
    instanceWorkspaceDirectory: readStringArg(payload, "instanceWorkspaceDirectory") || undefined,
    title: readStringArg(payload, "title") || undefined,
  });
}

export async function requestInstanceWorkspaceReload(
  ctx: any,
  payload?: { instanceWorkspaceDirectory?: string; title?: string },
): Promise<Record<string, unknown>> {
  const target = await resolveTargetInstanceWorkspaceContext(ctx, {
    instanceWorkspaceDirectory: typeof payload?.instanceWorkspaceDirectory === "string" ? payload.instanceWorkspaceDirectory : undefined,
  });
  if (!target) {
    return { ok: false, error: "target instance workspace context not found" };
  }

  const reloaded = await Promise.resolve(ctx?.client?.instance?.reload?.({ directory: target.instanceWorkspaceDirectory }))
    .then(() => true)
    .catch(() => false);
  if (!reloaded) {
    return {
      ok: false,
      error: "reload failed",
      instanceWorkspaceDirectory: target.instanceWorkspaceDirectory,
      title: target.title,
    };
  }

  return {
    ok: true,
    reloaded: true,
    instanceWorkspaceDirectory: target.instanceWorkspaceDirectory,
    title: target.title,
  };
}
