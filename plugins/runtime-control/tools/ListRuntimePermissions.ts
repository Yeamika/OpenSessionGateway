import { normalizeList, normalizePermissionStatus, normalizeString } from "../common.ts";
import type { RuntimeControlServices } from "../types.ts";

export const LIST_RUNTIME_PERMISSIONS_TOOL = {
  name: "ListRuntimePermissions",
  description: "List known permission items of one runtime",
  inputSchema: {
    type: "object",
    properties: {
      runtimeID: { type: "string", pattern: "\\S", description: "Target client runtimeID" },
      sessionID: { type: "string", description: "Optional sessionID filter" },
      status: {
        type: "string",
        enum: ["created", "pending", "approved", "denied", "cancelled", "expired", "superseded", "failed"],
        description: "Optional status filter",
      },
      list: { type: "number", description: "Maximum length to return. Default: 20" },
    },
    required: ["runtimeID"],
    additionalProperties: false,
  },
};

export function createListRuntimePermissionsToolHandler(services: RuntimeControlServices) {
  return async function handleListRuntimePermissionsTool(args: Record<string, unknown>) {
    const runtimeID = normalizeString(args.runtimeID);
    const sessionID = normalizeString(args.sessionID) || undefined;
    const status = normalizePermissionStatus(args.status) || undefined;
    const maxLen = normalizeList(args.list, 20);
    return services.osg.listRuntimePermissions({ runtimeID, sessionID, status, list: maxLen });
  };
}
