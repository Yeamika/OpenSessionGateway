import { normalizeList, normalizeRegex, normalizeString, readActiveCount, readLastActiveTime } from "../common.js";
import type { RuntimeControlServices } from "../types.js";

export const LIST_ACTIVED_SESSIONS_TOOL = {
  name: "ListActivedSessions",
  description: "List sessions that have been active on the server for one runtime",
  inputSchema: {
    type: "object",
    properties: {
      runtimeID: { type: "string", pattern: "\\S", description: "Target client runtimeID" },
      list: { type: "number", description: "Maximum length to return. Default: 10" },
      regex: { type: "string", description: "Regex filter for session id/title. Default: empty" },
    },
    required: ["runtimeID"],
    additionalProperties: false,
  },
};

export function createListActivedSessionsToolHandler(services: RuntimeControlServices) {
  return async function handleListActivedSessionsTool(args: Record<string, unknown>) {
    const runtimeID = normalizeString(args.runtimeID);
    await services.osg.requireOnlineRuntime(runtimeID);

    const maxLen = normalizeList(args.list, 10);
    const regexFilter = normalizeRegex(args.regex);
    const managed = await services.osg.listRuntimeManagedSessions(runtimeID);
    const clients = (await services.osg.listRuntimeClients())
      .filter((item) => item.runtimeID === runtimeID && typeof item.sessionID === "string" && item.sessionID.trim())
      .map((item) => ({
        sessionID: item.sessionID || "",
        title: item.title || "",
        state: item.sessionState || null,
        reason: item.sessionReason || null,
        meta: item.sessionMeta || null,
        lastActiveTime: readLastActiveTime(item as { lastActiveTime?: string | null }),
        activeCount: readActiveCount(item as { activeCount?: number }),
      }));
    const managedBySession = new Map(managed.map((item) => [item.sessionID, item]));
    const clientsBySession = new Map(clients.map((item) => [item.sessionID, item]));
      const merged = new Map<string, {
        name: string;
        id: string;
        state: "idle" | "busy" | "waiting" | "stopped" | null;
        reason: "completed" | "pending" | "tool" | "generating" | "reasoning" | "compacting" | "permission" | "question" | "aborted" | "error" | null;
        meta: Record<string, unknown> | null;
        time: string;
        lastActiveTime: string;
        activeCount: number;
      }>();

    function matches(id: string, name: string): boolean {
      if (!regexFilter) return true;
      return regexFilter.test(id) || regexFilter.test(name);
    }

    for (const client of clients) {
      if (merged.has(client.sessionID)) continue;
      const name = client.title || client.sessionID;
      if (!matches(client.sessionID, name)) continue;
      merged.set(client.sessionID, {
        name,
        id: client.sessionID,
        state: client.state,
        reason: client.reason,
        meta: client.meta,
        time: client.lastActiveTime,
        lastActiveTime: client.lastActiveTime,
        activeCount: Math.max(client.activeCount, readActiveCount(managedBySession.get(client.sessionID) as { activeCount?: number } | undefined)),
      });
    }

    for (const item of managed) {
      if (merged.has(item.sessionID)) continue;
      const client = clientsBySession.get(item.sessionID);
      const name = client?.title || item.sessionID;
      if (!matches(item.sessionID, name)) continue;
      merged.set(item.sessionID, {
        name,
        id: item.sessionID,
        state: item.state || null,
        reason: item.reason || null,
        meta: item.meta || null,
        time: readLastActiveTime(item as any),
        lastActiveTime: readLastActiveTime(item as any),
        activeCount: Math.max(readActiveCount(item as any), client?.activeCount || 0),
      });
    }

    const list = [...merged.values()]
      .sort((a, b) => {
        if (a.activeCount !== b.activeCount) return b.activeCount - a.activeCount;
        const activeTime = b.lastActiveTime.localeCompare(a.lastActiveTime);
        if (activeTime !== 0) return activeTime;
        const time = b.time.localeCompare(a.time);
        if (time !== 0) return time;
        return a.id.localeCompare(b.id);
      })
      .slice(0, maxLen);
    return { realsize: merged.size, list };
  };
}
