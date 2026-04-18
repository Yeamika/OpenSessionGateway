import type { TemplateRuntimeState } from "../runtime-state.js";

export async function getSessionMsg(
  state: TemplateRuntimeState,
  payload?: { sessionID?: string; size?: number; regex?: string },
): Promise<Record<string, unknown>> {
  return state.getSessionMsg(payload);
}
