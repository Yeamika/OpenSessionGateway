export const COMPACT_SESSION_EVENT = "CompactSession";

export type CompactSessionRequest = {
  sessionID: string;
  model?: string;
  auto?: boolean;
};

export type CompactSessionResponse = {
  ok: boolean;
  sessionID: string;
  model?: string;
  auto?: boolean;
  error?: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function createCompactSessionRequest(input: {
  sessionID?: string;
  model?: string;
  auto?: boolean;
}): CompactSessionRequest {
  return {
    sessionID: text(input.sessionID),
    model: text(input.model) || undefined,
    auto: input.auto === true ? true : undefined,
  };
}

export function readCompactSessionResponse(raw: unknown): CompactSessionResponse {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    ok: src.ok === true,
    sessionID: text(src.sessionID),
    model: text(src.model) || undefined,
    auto: src.auto === true ? true : undefined,
    error: text(src.error) || text(src.message) || undefined,
  };
}
