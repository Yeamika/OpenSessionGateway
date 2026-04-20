import { createWsEnvelope, type WsEnvelope } from "../WsEnvelope.js";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export const CLIENT_CONTENT_EXECUTEING_EVENT = "ClientContentExecuteing";

export type ClientSessionState = "idle" | "busy" | "waiting" | "stopped";
export type ClientSessionReason =
  | "completed"
  | "pending"
  | "tool"
  | "generating"
  | "reasoning"
  | "compacting"
  | "permission"
  | "question"
  | "aborted"
  | "error";

export type ClientSessionMeta = Record<string, unknown>;

export function normalizeClientSessionState(value: unknown): ClientSessionState | undefined {
  return value === "idle" || value === "busy" || value === "waiting" || value === "stopped" ? value : undefined;
}

export function normalizeClientSessionReason(value: unknown): ClientSessionReason | undefined {
  switch (value) {
    case "completed":
    case "pending":
    case "tool":
    case "generating":
    case "reasoning":
    case "compacting":
    case "permission":
    case "question":
    case "aborted":
    case "error":
      return value;
    default:
      return undefined;
  }
}

export function normalizeClientSessionMeta(value: unknown): ClientSessionMeta | undefined {
  return record(value) || undefined;
}

export type ClientContentExecuteingPayload = {
  displayID?: string;
  instanceWorkspaceDirectory?: string;
  session?: {
    sessionID?: string;
    title?: string;
    state?: ClientSessionState;
    reason?: ClientSessionReason;
    meta?: ClientSessionMeta;
  };
};

export function createClientContentExecuteingPayload(input: {
  displayID?: string;
  instanceWorkspaceDirectory?: string;
  session?: {
    sessionID?: string;
    title?: string;
    state?: ClientSessionState;
    reason?: ClientSessionReason;
    meta?: ClientSessionMeta;
  };
}): ClientContentExecuteingPayload {
  const sessionID = text(input.session?.sessionID);
  const title = text(input.session?.title);
  const state = normalizeClientSessionState(input.session?.state);
  const reason = normalizeClientSessionReason(input.session?.reason);
  const meta = normalizeClientSessionMeta(input.session?.meta);
  const session = sessionID || title || state || reason || meta
    ? {
        sessionID: sessionID || undefined,
        title: title || undefined,
        state,
        reason,
        meta,
      }
    : undefined;

  return {
    displayID: text(input.displayID) || undefined,
    instanceWorkspaceDirectory: text(input.instanceWorkspaceDirectory) || undefined,
    session,
  };
}

export function readClientContentExecuteingPayload(raw: unknown): ClientContentExecuteingPayload {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const session = src.session && typeof src.session === "object" ? (src.session as Record<string, unknown>) : {};
  return createClientContentExecuteingPayload({
    displayID: typeof src.displayID === "string" ? src.displayID : undefined,
    instanceWorkspaceDirectory: typeof src.instanceWorkspaceDirectory === "string" ? src.instanceWorkspaceDirectory : undefined,
    session: {
      sessionID: typeof session.sessionID === "string" ? session.sessionID : undefined,
      title: typeof session.title === "string" ? session.title : undefined,
      state: normalizeClientSessionState(session.state),
      reason: normalizeClientSessionReason(session.reason),
      meta: normalizeClientSessionMeta(session.meta),
    },
  });
}

export function createClientContentExecuteingEnvelope(input: { requestID?: string; data?: ClientContentExecuteingPayload }): WsEnvelope<ClientContentExecuteingPayload> {
  return createWsEnvelope({
    type: CLIENT_CONTENT_EXECUTEING_EVENT,
    requestID: input.requestID,
    data: createClientContentExecuteingPayload(input.data || {}),
  });
}
