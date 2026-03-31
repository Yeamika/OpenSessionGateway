function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export const WS_EVENT_RESPONSE_TYPE = "event_response";
export const WS_ERROR_TYPE = "error";

export type WsEnvelope<T = unknown> = {
  type: string;
  requestID: string;
  data: T | null;
};

export type WsEventResponse<T = unknown> = {
  type: typeof WS_EVENT_RESPONSE_TYPE;
  requestID: string;
  ok: boolean;
  data: T | null;
};

export type WsErrorEnvelope = {
  type: typeof WS_ERROR_TYPE;
  code: string;
  message: string;
};

export function createWsEnvelope<T>(input: {
  type?: string;
  requestID?: string;
  data?: T | null;
}): WsEnvelope<T> {
  return {
    type: normalizeString(input.type),
    requestID: normalizeString(input.requestID),
    data: input.data === undefined ? null : input.data,
  };
}

export function readWsEnvelope<T = unknown>(raw: unknown): WsEnvelope<T> {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    type: normalizeString(src.type),
    requestID: normalizeString(src.requestID),
    data: (src.data === undefined ? null : src.data) as T | null,
  };
}

export function createWsEventResponse<T>(input: {
  requestID?: string;
  ok?: boolean;
  data?: T | null;
}): WsEventResponse<T> {
  return {
    type: WS_EVENT_RESPONSE_TYPE,
    requestID: normalizeString(input.requestID),
    ok: input.ok === true,
    data: input.data === undefined ? null : input.data,
  };
}

export function readWsEventResponse<T = unknown>(raw: unknown): WsEventResponse<T> {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    type: WS_EVENT_RESPONSE_TYPE,
    requestID: normalizeString(src.requestID),
    ok: src.ok === true,
    data: (src.data === undefined ? null : src.data) as T | null,
  };
}

export function createWsErrorEnvelope(input: {
  code?: string;
  message?: string;
}): WsErrorEnvelope {
  return {
    type: WS_ERROR_TYPE,
    code: normalizeString(input.code),
    message: normalizeString(input.message),
  };
}

export function readWsErrorEnvelope(raw: unknown): WsErrorEnvelope {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    type: WS_ERROR_TYPE,
    code: normalizeString(src.code),
    message: normalizeString(src.message),
  };
}
