import {
  createClientContentExecuteingEnvelope,
  createClientContentExecuteingPayload,
  type ClientContentExecuteingPayload,
} from "@opensessiongateway/protocol-library";

export function createClientContentExecuteing(
  input: {
    displayID?: string
    instanceWorkspaceDirectory?: string
    session?: {
      sessionID?: string
      title?: string
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
