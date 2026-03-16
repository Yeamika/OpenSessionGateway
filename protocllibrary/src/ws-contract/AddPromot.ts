export type AddPromotRole = "user" | "system" | "tool";

export type AddPromotRequestPayload = {
  sessionID: string;
  msg: string;
  model?: string;
  role?: AddPromotRole;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeAddPromotRole(value: unknown): AddPromotRole {
  const roleRaw = normalizeString(value).toLowerCase();
  return roleRaw === "system" || roleRaw === "tool" ? roleRaw : "user";
}

export function createAddPromotRequest(payload: {
  sessionID?: string;
  msg?: string;
  model?: string;
  role?: string;
}): AddPromotRequestPayload {
  const sessionID = normalizeString(payload.sessionID);
  const msg = normalizeString(payload.msg);
  const model = normalizeString(payload.model);
  const role = normalizeAddPromotRole(payload.role);

  return {
    sessionID,
    msg,
    model: model || undefined,
    role,
  };
}

export function readAddPromotResponse(data: unknown): {
  ok: boolean;
  role: AddPromotRole;
  model: string | null;
  sessionID: string;
  error?: string;
} {
  const src = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const role = normalizeAddPromotRole(src.role);
  const model = normalizeString(src.model) || null;
  const sessionID = normalizeString(src.sessionID);
  const error = typeof src.error === "string" ? src.error : undefined;
  return {
    ok: src.ok === true,
    role,
    model,
    sessionID,
    ...(error ? { error } : {}),
  };
}
