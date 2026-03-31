export const REQUEST_RUNTIME_EVENT = "RequestRuntime";

export type RequestRuntimeRequestPayload = {
  sessionID: string;
};

export type RequestRuntimeResponsePayload = {
  ok: boolean;
  runtimeID: string;
  synced: boolean;
  session: {
    requested: boolean;
    exists: boolean;
    sessionID: string;
    title?: string;
    status?: "idle" | "busy" | "error" | null;
    displayID?: string | null;
  };
  currentStatus?: string | null;
  error?: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nullableStatus(value: unknown): "idle" | "busy" | "error" | null {
  return value === "idle" || value === "busy" || value === "error" ? value : null;
}

export function createRequestRuntimePayload(input: {
  sessionID?: string;
}): RequestRuntimeRequestPayload {
  return {
    sessionID: text(input.sessionID),
  };
}

export function readRequestRuntimeResponsePayload(raw: unknown): RequestRuntimeResponsePayload {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const sessionSrc = src.session && typeof src.session === "object" ? (src.session as Record<string, unknown>) : {};
  return {
    ok: src.ok === true,
    runtimeID: text(src.runtimeID),
    synced: src.synced === true,
    session: {
      requested: sessionSrc.requested === true,
      exists: sessionSrc.exists === true,
      sessionID: text(sessionSrc.sessionID),
      title: text(sessionSrc.title) || undefined,
      status: nullableStatus(sessionSrc.status),
      displayID: text(sessionSrc.displayID) || null,
    },
    currentStatus: text(src.currentStatus) || null,
    error: text(src.error) || undefined,
  };
}
