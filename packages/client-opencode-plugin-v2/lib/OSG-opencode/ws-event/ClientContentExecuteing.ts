import {
  createClientContentExecuteingEnvelope,
  createClientContentExecuteingPayload,
  type ClientContentExecuteingPayload,
  type ClientSessionMeta,
  type ClientSessionReason,
  type ClientSessionState,
} from "@opensessiongateway/protocol-library/ws-protocol/ClientContentExecuteing.js";

export function createClientContentExecuteing(
  input: {
    displayID?: string
    instanceWorkspaceDirectory?: string
    session?: {
      sessionID?: string
      title?: string
      state?: ClientSessionState | null
      reason?: ClientSessionReason | null
      meta?: ClientSessionMeta | null
    }
  },
): ClientContentExecuteingPayload {
  return createClientContentExecuteingPayload({
    displayID: input.displayID,
    instanceWorkspaceDirectory: input.instanceWorkspaceDirectory,
    session: input.session,
  })
}

export function createClientContentExecuteingWs(payload: ClientContentExecuteingPayload) {
  return createClientContentExecuteingEnvelope({
    requestID: `content_${Date.now()}`,
    data: payload,
  })
}
