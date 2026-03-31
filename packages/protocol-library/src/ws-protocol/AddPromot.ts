export type AddPromotRequestPayload = {
  sessionID: string;
  msg: string;
  model?: string;
  system?: string;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function createAddPromotRequest(payload: {
  sessionID?: string;
  msg?: string;
  model?: string;
  system?: string;
}): AddPromotRequestPayload {
  const sessionID = normalizeString(payload.sessionID);
  const msg = normalizeString(payload.msg);
  const model = normalizeString(payload.model);
  const system = normalizeString(payload.system);

  return {
    sessionID,
    msg,
    model: model || undefined,
    system: system || undefined,
  };
}

export function readAddPromotResponse(data: unknown): {
  ok: boolean;
  model: string | null;
  sessionID: string;
  error?: string;
} {
  const src = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const model = normalizeString(src.model) || null;
  const sessionID = normalizeString(src.sessionID);
  const error = typeof src.error === "string" ? src.error : undefined;
  return {
    ok: src.ok === true,
    model,
    sessionID,
    ...(error ? { error } : {}),
  };
}
