import {
  normalizeClientSessionMeta,
  normalizeClientSessionReason,
  normalizeClientSessionState,
} from "./ClientContentExecuteing.js";

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
    state?: "idle" | "busy" | "waiting" | "stopped" | null;
    reason?: "completed" | "pending" | "tool" | "generating" | "reasoning" | "compacting" | "permission" | "question" | "aborted" | "error" | null;
    meta?: Record<string, unknown> | null;
    displayID?: string | null;
  };
  error?: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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
      state: normalizeClientSessionState(sessionSrc.state) || null,
      reason: normalizeClientSessionReason(sessionSrc.reason) || null,
      meta: normalizeClientSessionMeta(sessionSrc.meta) || null,
      displayID: text(sessionSrc.displayID) || null,
    },
    error: text(src.error) || undefined,
  };
}
