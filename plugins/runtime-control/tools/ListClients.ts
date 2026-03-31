import { busyLabel, normalizeList, readActiveCount, readLastActiveTime } from "../common.ts";
import type { RuntimeControlServices } from "../types.ts";

export const LIST_CLIENTS_TOOL = {
  name: "ListClients",
  description: "List all online clients",
  inputSchema: {
    type: "object",
    properties: {
      list: {
        type: "number",
        description: "Maximum length to return. Default: 10",
      },
    },
    additionalProperties: false,
  },
};

export function createListClientsToolHandler(services: RuntimeControlServices) {
  return async function handleListClientsTool(args: Record<string, unknown>) {
    const maxLen = normalizeList(args.list, 10);
    const clients = await services.osg.listRuntimeClients();
    const online = clients.filter((item) => item.status === "online");
    const list = online.map((item) => ({
      runtimeID: item.runtimeID,
      title: item.title || "",
      sessionID: item.sessionID || "",
      currentStatus: busyLabel(item.sessionStatus),
      lastActiveTime: readLastActiveTime(item as { lastActiveTime?: string | null }),
      activeCount: readActiveCount(item as { activeCount?: number }),
    }));
    return { realsize: list.length, list: list.slice(0, maxLen) };
  };
}
