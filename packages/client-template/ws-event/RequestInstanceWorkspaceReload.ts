import type { TemplateRuntimeState } from "../runtime-state.js";

export async function requestInstanceWorkspaceReload(
  state: TemplateRuntimeState,
  payload?: { instanceWorkspaceDirectory?: string; title?: string },
): Promise<Record<string, unknown>> {
  return state.requestInstanceWorkspaceReload(payload);
}
