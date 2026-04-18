import type { TemplateRuntimeState } from "../runtime-state.js";

export async function listAvailableModels(
  state: TemplateRuntimeState,
  payload?: { list?: number; regex?: string },
): Promise<Record<string, unknown>> {
  return state.listAvailableModels(payload);
}
