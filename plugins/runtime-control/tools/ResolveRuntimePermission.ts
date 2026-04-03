import { normalizePermissionDecision, normalizeString } from "../common.js";
import type { RuntimeControlServices } from "../types.js";

export const RESOLVE_RUNTIME_PERMISSION_TOOL = {
  name: "ResolveRuntimePermission",
  description: "Resolve one pending permission item through a target runtime",
  inputSchema: {
    type: "object",
    properties: {
      runtimeID: { type: "string", pattern: "\\S", description: "Target client runtimeID" },
      permissionID: { type: "string", pattern: "\\S", description: "Target permissionID" },
      action: {
        type: "string",
        enum: ["approve", "deny", "cancel"],
        description: "Permission decision",
      },
      reason: { type: "string", description: "Optional resolution reason" },
      actor: { type: "string", description: "Optional controller identity" },
      correlationID: { type: "string", description: "Optional correlation id" },
    },
    required: ["runtimeID", "permissionID", "action"],
    additionalProperties: false,
  },
};

export function createResolveRuntimePermissionToolHandler(services: RuntimeControlServices) {
  return async function handleResolveRuntimePermissionTool(args: Record<string, unknown>) {
    const runtimeID = normalizeString(args.runtimeID);
    const permissionID = normalizeString(args.permissionID);
    const action = normalizePermissionDecision(args.action);
    const reason = normalizeString(args.reason) || undefined;
    const actor = normalizeString(args.actor) || undefined;
    const correlationID = normalizeString(args.correlationID) || undefined;

    await services.osg.requireOnlineRuntime(runtimeID);

    return services.osg.resolveRuntimePermission({ runtimeID, permissionID, action, reason, actor, correlationID });
  };
}
