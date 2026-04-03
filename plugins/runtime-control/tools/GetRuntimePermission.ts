import { normalizeString } from "../common.js";
import type { RuntimeControlServices } from "../types.js";

export const GET_RUNTIME_PERMISSION_TOOL = {
  name: "GetRuntimePermission",
  description: "Get one known permission item of a runtime",
  inputSchema: {
    type: "object",
    properties: {
      runtimeID: { type: "string", pattern: "\\S", description: "Target client runtimeID" },
      permissionID: { type: "string", pattern: "\\S", description: "Target permissionID" },
    },
    required: ["runtimeID", "permissionID"],
    additionalProperties: false,
  },
};

export function createGetRuntimePermissionToolHandler(services: RuntimeControlServices) {
  return async function handleGetRuntimePermissionTool(args: Record<string, unknown>) {
    const runtimeID = normalizeString(args.runtimeID);
    const permissionID = normalizeString(args.permissionID);
    return services.osg.getRuntimePermission({ runtimeID, permissionID });
  };
}
