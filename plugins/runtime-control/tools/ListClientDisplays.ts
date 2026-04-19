import { normalizeList, normalizeRegex, normalizeString, readActiveCount, readLastActiveTime } from "../common.js";
import type { RuntimeControlServices } from "../types.js";

export const LIST_CLIENT_DISPLAYS_TOOL = {
  name: "ListClientDisplays",
  description: "List current TUI/display bindings of one client runtime",
  inputSchema: {
    type: "object",
    properties: {
      runtimeID: { type: "string", pattern: "\\S", description: "Target client runtimeID" },
      list: { type: "number", description: "Maximum length to return. Default: 10" },
      regex: { type: "string", description: "Regex filter for displayID/sessionID/title/instanceWorkspaceDirectory. Default: empty" },
    },
    required: ["runtimeID"],
    additionalProperties: false,
  },
};

type DisplayView = {
  runtimeID: string;
  displayID: string;
  sessionID: string;
  title: string;
  instanceWorkspaceDirectory: string;
  sessionState: "idle" | "busy" | "waiting" | "stopped" | null;
  sessionReason: "completed" | "pending" | "tool" | "generating" | "reasoning" | "compacting" | "permission" | "question" | "aborted" | "error" | null;
  sessionMeta: Record<string, unknown> | null;
  lastActiveTime: string;
  activeCount: number;
};

function compareDisplayView(a: DisplayView, b: DisplayView): number {
  if (a.activeCount !== b.activeCount) return b.activeCount - a.activeCount;
  const activeTime = b.lastActiveTime.localeCompare(a.lastActiveTime);
  if (activeTime !== 0) return activeTime;
  const title = a.title.localeCompare(b.title);
  if (title !== 0) return title;
  return a.displayID.localeCompare(b.displayID);
}

export function createListClientDisplaysToolHandler(services: RuntimeControlServices) {
  return async function handleListClientDisplaysTool(args: Record<string, unknown>) {
    const runtimeID = normalizeString(args.runtimeID);
    const maxLen = normalizeList(args.list, 10);
    const regex = normalizeRegex(args.regex);

    await services.osg.requireOnlineRuntime(runtimeID);

    const clients = await services.osg.listRuntimeClients();
    const displays = new Map<string, DisplayView>();

    for (const item of clients) {
      if (item.runtimeID !== runtimeID) continue;
      if (item.status !== "online") continue;
      const displayID = normalizeString(item.displayID);
      if (!displayID) continue;

      const next: DisplayView = {
        runtimeID,
        displayID,
        sessionID: normalizeString(item.sessionID),
        title: normalizeString(item.title),
        instanceWorkspaceDirectory: normalizeString((item as { instanceWorkspaceDirectory?: string | null }).instanceWorkspaceDirectory),
        sessionState: item.sessionState || null,
        sessionReason: item.sessionReason || null,
        sessionMeta: item.sessionMeta || null,
        lastActiveTime: readLastActiveTime(item as { lastActiveTime?: string | null }),
        activeCount: readActiveCount(item as { activeCount?: number }),
      };

      const hit = displays.get(displayID);
      if (!hit || compareDisplayView(next, hit) < 0) {
        displays.set(displayID, next);
      }
    }

    const list = [...displays.values()]
      .filter((item) => {
        if (!regex) return true;
        const text = `${item.displayID}\n${item.sessionID}\n${item.title}\n${item.instanceWorkspaceDirectory}`;
        return regex.test(text);
      })
      .sort(compareDisplayView)
      .slice(0, maxLen);

    return { realsize: displays.size, list };
  };
}
