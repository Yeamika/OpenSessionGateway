import type { TemplateRuntimeState } from "../runtime-state.js";

export async function resolvePermissionRequest(
  state: TemplateRuntimeState,
  payload?: {
    permissionID?: string;
    action?: "approve" | "deny" | "cancel";
    reason?: string;
    actor?: string;
    correlationID?: string;
  },
): Promise<Record<string, unknown>> {
  return state.resolvePermissionRequest(payload);
}
