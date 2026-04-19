import { normalizeList, normalizeRegex, readActiveCount, readLastActiveTime } from "../common.js";
import type { SessionBridgeServices } from "../types.js";

export const LIST_LIVING_SESSIONS_TOOL = {
  name: "ListLivingSessions",
  description: "Session gateway and network neighbors: list online sessions",
  inputSchema: {
    type: "object",
    properties: {
      ExecutorSessionID: {
        type: "string",
        pattern: "\\S",
        description: "Executor sessionID",
      },
      list: {
        type: "number",
        description: "Maximum length to return. Default: 10",
      },
      regex: {
        type: "string",
        description: "Regex filter for runtimeID/sessionID/title. Default: empty",
      },
    },
    required: ["ExecutorSessionID"],
    additionalProperties: false,
  },
};

export function createListLivingSessionsToolHandler(services: SessionBridgeServices) {
  return async function handleListLivingSessionsTool(toolArgs: Record<string, unknown>, requesterRuntimeID: string) {
    const clients = await services.osg.listRuntimeClients();
    const online = clients.filter((item) => item.status === "online");
    const executorSessionID = typeof toolArgs.ExecutorSessionID === "string" ? toolArgs.ExecutorSessionID.trim() : "";
    const regex = normalizeRegex(toolArgs.regex);
    const maxLen = normalizeList(toolArgs.list, 10);

    const matched = online
      .filter((item) => {
        if (!regex) return true;
        const text = `${item.runtimeID}\n${item.sessionID || ""}\n${item.title || ""}`;
        return regex.test(text);
      })
      .sort((a, b) => {
        const aTime = Date.parse(readLastActiveTime(a as { lastActiveTime?: string | null })) || 0;
        const bTime = Date.parse(readLastActiveTime(b as { lastActiveTime?: string | null })) || 0;
        if (aTime !== bTime) return bTime - aTime;
        const activeDiff = readActiveCount(b as { activeCount?: number }) - readActiveCount(a as { activeCount?: number });
        if (activeDiff !== 0) return activeDiff;
        return (a.sessionID || "").localeCompare(b.sessionID || "");
      })
      .map((item) => ({
        runtimeID: item.runtimeID,
        title: item.title || "",
        sessionID: item.sessionID || "",
        sessionState: item.sessionState || null,
        sessionReason: item.sessionReason || null,
        sessionMeta: item.sessionMeta || null,
        lastActiveTime: readLastActiveTime(item as { lastActiveTime?: string | null }),
        activeCount: readActiveCount(item as { activeCount?: number }),
      }));

    const requester = online.find((item) => item.runtimeID === requesterRuntimeID && (item.sessionID || "") === executorSessionID);
    const requesterSessionIDRaw = requester?.sessionID?.trim() || "";
    const requesterSessionTitleRaw = requester?.title?.trim() || "";
    const requesterSessionID =
      !requesterSessionIDRaw || requesterSessionIDRaw === "-"
        ? "Current session is new, ID is being generated. It will be returned on the next call."
        : requesterSessionIDRaw;
    const requesterSessionTitle =
      !requesterSessionTitleRaw || requesterSessionTitleRaw === "-"
        ? "Current session is new, title is being generated. It will be returned on the next call."
        : requesterSessionTitleRaw;

    return {
      requesterRuntimeID,
      requesterSessionID,
      requesterSessionTitle,
      realsize: matched.length,
      list: matched.slice(0, maxLen),
    };
  };
}
