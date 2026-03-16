export type { ListSessionResponsePayload as SessionListResponse, SessionListItem } from "protocllibrary/ws-contract/SessionList.js";
import type { ListSessionResponsePayload as SessionListResponse, SessionListItem } from "protocllibrary/ws-contract/SessionList.js";
import { createListSessionRequestPayload } from "protocllibrary/ws-contract/SessionList.js";

function normalizeRegex(value: unknown): RegExp | null {
  if (typeof value !== "string") return null;
  const source = value.trim();
  if (!source) return null;
  try {
    return new RegExp(source);
  } catch {
    return null;
  }
}

function normalizeSessionFromRuntime(item: unknown): SessionListItem | null {
  if (!item || typeof item !== "object") return null;
  const src = item as Record<string, unknown>;
  const id = typeof src.id === "string" ? src.id.trim() : "";
  if (!id) return null;
  const title = typeof src.title === "string" && src.title.trim() ? src.title.trim() : undefined;
  const status = typeof src.status === "string" && src.status.trim() ? src.status.trim() : undefined;
  const timeRaw =
    typeof src.updatedAt === "string"
      ? src.updatedAt
      : typeof src.lastMessageAt === "string"
        ? src.lastMessageAt
        : typeof src.createdAt === "string"
          ? src.createdAt
          : "";
  const time = timeRaw.trim() ? timeRaw.trim() : undefined;
  return { id, title, status, time };
}

export async function readCurrentSessionList(
  ctx: any,
  query: () => Record<string, unknown>,
  payload?: { list?: number; regex?: string; directory?: string },
): Promise<SessionListResponse> {
  const request = createListSessionRequestPayload(payload || {});
  const listLimit = request.list;
  const regex = normalizeRegex(request.regex);
  const baseQuery = query() || {};
  const runtimeQuery = {
    ...baseQuery,
    directory: request.directory || baseQuery.directory,
  };
  const result = await ctx?.client?.session?.list?.({ query: runtimeQuery }).catch(() => null);
  if (!result || result.error || !Array.isArray(result.data)) {
    return {
      meta: { matched: 0 },
      sessions: [],
    };
  }

  const matched: SessionListItem[] = [];
  for (const item of result.data) {
    const normalized = normalizeSessionFromRuntime(item);
    if (!normalized) continue;
    if (regex && !regex.test(normalized.id) && !(normalized.title && regex.test(normalized.title))) {
      continue;
    }
    matched.push(normalized);
  }

  return {
    meta: { matched: matched.length },
    sessions: matched.slice(0, listLimit),
  };
}
