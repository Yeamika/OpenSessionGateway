export type SessionListItem = {
  id: string;
  title?: string;
  status?: string;
  time?: string;
};

export type ListSessionRequestPayload = {
  list: number;
  regex?: string;
  directory?: string;
};

export type ListSessionResponsePayload = {
  meta: {
    matched: number;
  };
  sessions: SessionListItem[];
};

function normalizeList(value: unknown, fallback = 10): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

export function createListSessionRequestPayload(input: {
  list?: number;
  regex?: string;
  directory?: string;
}): ListSessionRequestPayload {
  return {
    list: normalizeList(input.list, 10),
    regex: typeof input.regex === "string" && input.regex.trim() ? input.regex.trim() : undefined,
    directory: typeof input.directory === "string" && input.directory.trim() ? input.directory.trim() : undefined,
  };
}

export function readListSessionResponsePayload(raw: unknown): ListSessionResponsePayload {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const metaSrc = src.meta && typeof src.meta === "object" ? (src.meta as Record<string, unknown>) : {};
  const sessions = Array.isArray(src.sessions) ? (src.sessions as SessionListItem[]) : [];
  const matchedRaw = Number(metaSrc.matched);
  const matched = Number.isInteger(matchedRaw) && matchedRaw >= 0 ? matchedRaw : sessions.length;
  return {
    meta: { matched },
    sessions,
  };
}
