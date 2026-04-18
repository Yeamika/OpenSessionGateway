import type { TemplateRuntimeState } from "../runtime-state.js";

export function listSession(
  state: TemplateRuntimeState,
  payload?: { list?: number; regex?: string },
) {
  return state.listSession(payload);
}
