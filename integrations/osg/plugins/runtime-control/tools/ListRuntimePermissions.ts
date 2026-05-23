import { normalizeList, normalizePermissionStatus, normalizeString } from "../common.js";
import type { RuntimeControlServices } from "../types.js";

export const LIST_RUNTIME_PERMISSIONS_TOOL = {
  name: "ListRuntimePermissions",
  description: "List known permission items of one runtime, or show one detailed permission by permissionID",
  inputSchema: {
    type: "object",
    properties: {
      runtimeID: { type: "string", pattern: "\\S", description: "Target client runtimeID" },
      permissionID: { type: "string", description: "Optional permissionID; when provided, returns detailed info of one permission" },
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
    const permissionID = normalizeString(args.permissionID) || undefined;
    const sessionID = normalizeString(args.sessionID) || undefined;
    const status = normalizePermissionStatus(args.status) || undefined;
    const maxLen = normalizeList(args.list, 20);

    if (permissionID) {
      return services.osg.getRuntimePermission({ runtimeID, permissionID });
    }

    const result = await services.osg.listRuntimePermissions({ runtimeID, sessionID, status, list: maxLen });
    return {
      realsize: result.realsize,
      list: result.list.map((item) => ({
        permissionID: item.permissionID,
        sessionID: item.sessionID,
        displayID: item.displayID,
        kind: item.kind,
        title: item.title,
        status: item.status,
        requestedAt: item.requestedAt,
        updatedAt: item.updatedAt,
        expiresAt: item.expiresAt,
      })),
    };
  };
}
