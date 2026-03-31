import { createWsEnvelope, type WsEnvelope } from "../WsEnvelope.js";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export const CLIENT_CONTENT_EXECUTEING_EVENT = "ClientContentExecuteing";

export type ClientContentExecuteingPayload = {
  displayID?: string;
  instanceWorkspaceDirectory?: string;
  session?: {
    sessionID?: string;
    title?: string;
    status?: "idle" | "busy" | "error";
  };
};

export function createClientContentExecuteingPayload(input: {
  displayID?: string;
  instanceWorkspaceDirectory?: string;
  session?: {
    sessionID?: string;
    title?: string;
    status?: "idle" | "busy" | "error";
  };
}): ClientContentExecuteingPayload {
  const sessionID = text(input.session?.sessionID);
  const title = text(input.session?.title);
  const status = input.session?.status === "idle" || input.session?.status === "busy" || input.session?.status === "error"
    ? input.session.status
    : undefined;
  const session = sessionID || title || status
    ? {
        sessionID: sessionID || undefined,
        title: title || undefined,
        status,
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
      status: session.status === "idle" || session.status === "busy" || session.status === "error" ? session.status : undefined,
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
