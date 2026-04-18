import type { TemplateRuntimeState } from "../runtime-state.js";

export function getCurrentClientInfo(state: TemplateRuntimeState) {
  return state.getCurrentClientInfo();
}
