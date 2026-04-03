import { normalizeList, readActiveCount, readLastActiveTime } from "../common.js";
import type { RuntimeControlServices } from "../types.js";

export const LIST_RUNTIME_TOOL = {
  name: "ListRuntime",
  description: "List all runtimes",
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

export function createListRuntimeToolHandler(services: RuntimeControlServices) {
  return async function handleListRuntimeTool(args: Record<string, unknown>) {
    const maxLen = normalizeList(args.list, 10);
    const clients = await services.osg.listRuntimeClients();
    const grouped = new Map<string, {
      runtimeID: string;
      status: "online" | "offline" | "stale";
      runtimeHost: string;
      runtimeProtocol: string;
      port: number | null;
      lastActiveTime: string;
      activeCount: number;
      sessionCount: number;
      displayCount: number;
    }>();

    const sessionIDs = new Map<string, Set<string>>();
    const displayIDs = new Map<string, Set<string>>();

    for (const item of clients) {
      const runtimeID = item.runtimeID;
      const current = grouped.get(runtimeID);
      const lastActiveTime = readLastActiveTime(item as { lastActiveTime?: string | null });
      const activeCount = readActiveCount(item as { activeCount?: number });

      if (!current) {
        grouped.set(runtimeID, {
          runtimeID,
          status: item.status,
          runtimeHost: item.runtimeHost || "",
          runtimeProtocol: item.runtimeProtocol || "",
          port: typeof item.port === "number" ? item.port : null,
          lastActiveTime,
          activeCount,
          sessionCount: 0,
          displayCount: 0,
        });
      } else {
        if (current.status !== "online" && item.status === "online") current.status = "online";
        if (!current.runtimeHost && item.runtimeHost) current.runtimeHost = item.runtimeHost;
        if (!current.runtimeProtocol && item.runtimeProtocol) current.runtimeProtocol = item.runtimeProtocol;
        if (current.port === null && typeof item.port === "number") current.port = item.port;
        if (lastActiveTime.localeCompare(current.lastActiveTime) > 0) current.lastActiveTime = lastActiveTime;
        if (activeCount > current.activeCount) current.activeCount = activeCount;
      }

      if (item.sessionID) {
        let set = sessionIDs.get(runtimeID);
        if (!set) {
          set = new Set<string>();
          sessionIDs.set(runtimeID, set);
        }
        set.add(item.sessionID);
      }
      if (item.displayID) {
        let set = displayIDs.get(runtimeID);
        if (!set) {
          set = new Set<string>();
          displayIDs.set(runtimeID, set);
        }
        set.add(item.displayID);
      }
    }

    const list = [...grouped.values()]
      .map((item) => ({
        ...item,
        sessionCount: sessionIDs.get(item.runtimeID)?.size || 0,
        displayCount: displayIDs.get(item.runtimeID)?.size || 0,
      }))
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === "online" ? -1 : 1;
        if (a.activeCount !== b.activeCount) return b.activeCount - a.activeCount;
        const activeTime = b.lastActiveTime.localeCompare(a.lastActiveTime);
        if (activeTime !== 0) return activeTime;
        return a.runtimeID.localeCompare(b.runtimeID);
      });
    return { realsize: list.length, list: list.slice(0, maxLen) };
  };
}
