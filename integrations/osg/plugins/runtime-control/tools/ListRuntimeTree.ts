import { normalizeList, normalizeRegex, normalizeString, readActiveCount, readLastActiveTime } from "../common.js";
import type { RuntimeControlServices } from "../types.js";

export const LIST_RUNTIME_TREE_TOOL = {
  name: "ListRuntimeTree",
  description: "List runtime summaries, runtime workspaces, or one detailed workspace depending on the specified scope",
  inputSchema: {
    type: "object",
    properties: {
      runtimeID: { type: "string", description: "Optional runtimeID; when provided, lists InstanceWorkspaces of that runtime" },
      instanceWorkspaceDirectory: { type: "string", description: "Optional target workspace directory; requires runtimeID and returns detailed workspace info" },
      list: { type: "number", description: "Maximum length to return. Default: 20" },
      regex: { type: "string", description: "Optional regex filter on runtime or workspace summary fields" },
    },
    additionalProperties: false,
  },
};

type RuntimeSummary = {
  runtimeID: string;
  status: "online" | "offline" | "stale";
  runtimeHost: string;
  runtimeProtocol: string;
  port: number | null;
  lastActiveTime: string;
  activeCount: number;
  sessionCount: number;
  displayCount: number;
};

export function createListRuntimeTreeToolHandler(services: RuntimeControlServices) {
  return async function handleListRuntimeTreeTool(args: Record<string, unknown>) {
    const runtimeID = normalizeString(args.runtimeID) || undefined;
    const instanceWorkspaceDirectory = normalizeString(args.instanceWorkspaceDirectory) || undefined;
    const maxLen = normalizeList(args.list, 20);
    const regex = normalizeRegex(args.regex);

    if (!runtimeID && instanceWorkspaceDirectory) {
      throw new Error("runtimeID is required when instanceWorkspaceDirectory is specified");
    }

    if (!runtimeID) {
      const clients = await services.osg.listRuntimeClients();
      const grouped = new Map<string, RuntimeSummary>();
      const sessionIDs = new Map<string, Set<string>>();
      const displayIDs = new Map<string, Set<string>>();

      for (const item of clients) {
        const id = item.runtimeID;
        const current = grouped.get(id);
        const lastActiveTime = readLastActiveTime(item as { lastActiveTime?: string | null });
        const activeCount = readActiveCount(item as { activeCount?: number });

        if (!current) {
          grouped.set(id, {
            runtimeID: id,
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
          let set = sessionIDs.get(id);
          if (!set) {
            set = new Set<string>();
            sessionIDs.set(id, set);
          }
          set.add(item.sessionID);
        }
        if (item.displayID) {
          let set = displayIDs.get(id);
          if (!set) {
            set = new Set<string>();
            displayIDs.set(id, set);
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
        .filter((item) => {
          if (!regex) return true;
          const text = `${item.runtimeID}\n${item.status}\n${item.runtimeHost}\n${item.runtimeProtocol}`;
          return regex.test(text);
        })
        .sort((a, b) => {
          if (a.status !== b.status) return a.status === "online" ? -1 : 1;
          if (a.activeCount !== b.activeCount) return b.activeCount - a.activeCount;
          const activeTime = b.lastActiveTime.localeCompare(a.lastActiveTime);
          if (activeTime !== 0) return activeTime;
          return a.runtimeID.localeCompare(b.runtimeID);
        });

      return { realsize: list.length, list: list.slice(0, maxLen) };
    }

    await services.osg.requireOnlineRuntime(runtimeID);
    const detailed = Boolean(instanceWorkspaceDirectory);
    const list = (await services.osg.listRuntimeInstanceWorkspaces(runtimeID))
      .filter((item) => {
        if (instanceWorkspaceDirectory && (item.instanceWorkspaceDirectory || "") !== instanceWorkspaceDirectory) return false;
        if (!regex) return true;
        const text = `${item.instanceWorkspaceDirectory || ""}\n${item.title || ""}`;
        return regex.test(text);
      })
      .map((item) => ({
        runtimeID: item.runtimeID,
        instanceWorkspaceDirectory: item.instanceWorkspaceDirectory || "",
        title: item.title || "",
        ...(detailed ? { agents: item.agents } : {}),
      }));

    return { realsize: list.length, list: list.slice(0, maxLen) };
  };
}
