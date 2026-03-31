import type { TemplateRuntimeState } from "../runtime-state.js";

export async function abortSessionOfClient(
  state: TemplateRuntimeState,
  payload?: { sessionID?: string },
): Promise<Record<string, unknown>> {
  return state.abortSessionOfClient(payload);
}
