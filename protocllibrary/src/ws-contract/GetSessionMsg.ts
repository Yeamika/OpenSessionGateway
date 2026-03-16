export type GetSessionMsgRequest = {
  sessionID: string;
  size: number;
  regex?: string;
};

export type GetSessionMsgItem = {
  id: string;
  role: string;
  content: string;
  time: string;
};

export type GetSessionMsgResponse = {
  runtimeID: string;
  sessionID: string;
  realsize: number;
  list: GetSessionMsgItem[];
  status: "busy" | "idle" | "interrupted";
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSize(value: unknown, fallback = 10): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

export function createGetSessionMsgRequest(input: {
  sessionID?: string;
  size?: number;
  regex?: string;
}): GetSessionMsgRequest {
  return {
    sessionID: normalizeString(input.sessionID),
    size: normalizeSize(input.size, 10),
    regex: normalizeString(input.regex) || undefined,
  };
}

export function readGetSessionMsgResponse(raw: unknown): GetSessionMsgResponse {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rows = Array.isArray(src.list) ? src.list : [];
  const list: GetSessionMsgItem[] = rows
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => ({
      id: normalizeString(item.id),
      role: normalizeString(item.role),
      content: normalizeString(item.content),
      time: normalizeString(item.time),
    }));

  const statusRaw = normalizeString(src.status).toLowerCase();
  const status: "busy" | "idle" | "interrupted" =
    statusRaw === "busy" ? "busy" : statusRaw === "interrupted" ? "interrupted" : "idle";
  const realsizeRaw = Number(src.realsize);

  return {
    runtimeID: normalizeString(src.runtimeID),
    sessionID: normalizeString(src.sessionID),
    realsize: Number.isInteger(realsizeRaw) && realsizeRaw >= 0 ? realsizeRaw : list.length,
    list,
    status,
  };
}
