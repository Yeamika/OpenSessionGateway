import type { ClientContentExecuteingPayload } from "@opensessiongateway/protocol-library";
import type { TemplateRuntimeState } from "../runtime-state.js";

export async function requestRuntime(
  state: TemplateRuntimeState,
  sendRuntimeContent: (payload: ClientContentExecuteingPayload) => boolean,
  payload?: { sessionID?: string },
): Promise<Record<string, unknown>> {
  const prepared = state.requestRuntime(payload);
  const synced = prepared.reportPayload ? sendRuntimeContent(prepared.reportPayload) : false;
  return {
    ...prepared.response,
    synced,
  };
}
