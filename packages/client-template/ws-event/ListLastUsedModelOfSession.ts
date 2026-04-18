import type { TemplateRuntimeState } from "../runtime-state.js";

export async function listLastUsedModelOfSession(
  state: TemplateRuntimeState,
  payload?: { sessionID?: string },
): Promise<Record<string, unknown>> {
  return state.listLastUsedModelOfSession(payload);
}
