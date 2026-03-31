function readTitle(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const src = value as Record<string, unknown>;
  const title = typeof src.title === "string" ? src.title.trim() : "";
  if (title) return title;
  const info = src.info && typeof src.info === "object" ? (src.info as Record<string, unknown>) : {};
  const infoTitle = typeof info.title === "string" ? info.title.trim() : "";
  if (infoTitle) return infoTitle;
  const session = src.session && typeof src.session === "object" ? (src.session as Record<string, unknown>) : {};
  return typeof session.title === "string" ? session.title.trim() : "";
}

export async function refreshSessionTitle(
  ctx: any,
  _query: () => Record<string, unknown>,
  sessionID: string,
  directory?: string,
): Promise<string> {
  const cleanSessionID = typeof sessionID === "string" ? sessionID.trim() : "";
  if (!cleanSessionID) return "";

  const cleanDirectory = typeof directory === "string" && directory.trim() ? directory.trim() : undefined;
  const result = await ctx?.client?.session
    ?.get?.({
      path: { id: cleanSessionID },
      query: cleanDirectory ? { directory: cleanDirectory } : undefined,
    })
    .catch(() => null);

  const title = !result || result.error ? "" : readTitle(result.data);
  return title;
}
