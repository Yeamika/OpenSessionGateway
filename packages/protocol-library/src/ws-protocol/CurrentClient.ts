export type QueueShape = {
  runtimeID: string;
  hostName: string;
  events: Array<{ type?: string } | unknown>;
};

export type CurrentClientInfo = {
  runtimeID: string;
  sessionID: string;
  sessionTitle: string;
  status: string;
  cwd: string;
};

export type CurrentClientInfoCallbacks = {
  GetCurrentClientInfo?: () => Promise<Partial<CurrentClientInfo>> | Partial<CurrentClientInfo>;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function createFallbackCurrentClientInfo(): CurrentClientInfo {
  return {
    runtimeID: "unknown",
    sessionID: "-",
    sessionTitle: "-",
    status: "-",
    cwd: "unknown",
  };
}

export function readCurrentClientInfo(raw: unknown): CurrentClientInfo {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const fallback = createFallbackCurrentClientInfo();
  return {
    runtimeID: normalizeString(src.runtimeID) || fallback.runtimeID,
    sessionID: normalizeString(src.sessionID) || fallback.sessionID,
    sessionTitle: normalizeString(src.sessionTitle) || fallback.sessionTitle,
    status: normalizeString(src.status) || fallback.status,
    cwd: normalizeString(src.cwd) || fallback.cwd,
  };
}
