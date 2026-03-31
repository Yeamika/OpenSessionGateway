import type { TemplateRuntimeState } from "../runtime-state.js";

export async function addPromot(
  state: TemplateRuntimeState,
  payload?: { sessionID?: string; msg?: string; model?: string; system?: string },
): Promise<Record<string, unknown>> {
  return state.addPromot(payload);
}
