import type { TemplateRuntimeState } from "../runtime-state.js";

export async function createNewSession(
  state: TemplateRuntimeState,
  payload?: {
    instanceWorkspaceDirectory?: string;
    content?: string;
    title?: string;
    model?: string;
    displayID?: string;
  },
): Promise<Record<string, unknown>> {
  return state.createNewSession(payload);
}
