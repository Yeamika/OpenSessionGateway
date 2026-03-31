import type { TemplateRuntimeState } from "../runtime-state.js";

export async function setClientDisplaySession(
  state: TemplateRuntimeState,
  payload?: { displayID?: string; sessionID?: string },
): Promise<Record<string, unknown>> {
  return state.setClientDisplaySession(payload);
}
