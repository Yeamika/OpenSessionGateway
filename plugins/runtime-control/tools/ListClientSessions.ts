import { normalizeList, normalizeString, readActiveCount, readLastActiveTime } from "../common.ts";
import type { RuntimeControlServices } from "../types.ts";

export const LIST_CLIENT_SESSIONS_TOOL = {
  name: "ListClientSessions",
  description: "List selectable sessions of one client runtime",
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

export function createListClientSessionsToolHandler(services: RuntimeControlServices) {
  return async function handleListClientSessionsTool(args: Record<string, unknown>) {
    const runtimeID = normalizeString(args.runtimeID);
    await services.osg.requireOnlineRuntime(runtimeID);

    const maxLen = normalizeList(args.list, 10);
    const regex = normalizeString(args.regex) || undefined;
    const managed = await services.osg.listRuntimeManagedSessions(runtimeID);
    const requestLen = Math.max(maxLen, managed.length || 0);
    const result = await services.osg.requestSessionList({ runtimeID, list: requestLen, regex });
    const managedBySession = new Map(managed.map((item) => [item.sessionID, item]));
    const list = result.sessions
      .map((item) => {
        const meta = managedBySession.get(item.id);
        return {
          name: item.title || item.id,
          id: item.id,
          time: typeof item.time === "string" ? item.time : "",
          lastActiveTime: readLastActiveTime(meta as { lastActiveTime?: string | null } | undefined),
          activeCount: readActiveCount(meta as { activeCount?: number } | undefined),
        };
      })
      .sort((a, b) => {
        if (a.activeCount !== b.activeCount) return b.activeCount - a.activeCount;
        const activeTime = b.lastActiveTime.localeCompare(a.lastActiveTime);
        if (activeTime !== 0) return activeTime;
        const time = b.time.localeCompare(a.time);
        if (time !== 0) return time;
        return a.id.localeCompare(b.id);
      });
    return { realsize: result.meta.matched, list };
  };
}
