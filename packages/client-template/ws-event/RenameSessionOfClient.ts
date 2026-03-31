import type { TemplateRuntimeState } from "../runtime-state.js";

export async function renameSessionOfClient(
  state: TemplateRuntimeState,
  payload?: { sessionID?: string; title?: string },
): Promise<Record<string, unknown>> {
  return state.renameSessionOfClient(payload);
}
