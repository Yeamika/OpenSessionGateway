import { requireOnlineRuntime } from "@/lib/runtime-validation";
import { requestSessionList } from "@/lib/v2/ws";

export const LIST_SESSION_OF_CLIENT_TOOL = {
  name: "ListSessionOfClient",
  description: "List selectable sessions of one client runtime",
  inputSchema: {
    type: "object",
    properties: {
      runtimeID: { type: "string", description: "Target client runtimeID" },
      list: { type: "number", description: "Maximum length to return. Default: 10" },
      regex: { type: "string", description: "Regex filter for session id/title. Default: empty" },
    },
    required: ["runtimeID"],
    additionalProperties: false,
  },
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeList(value: unknown, fallback = 10): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

export async function handleListSessionOfClientTool(args: Record<string, unknown>) {
  const runtimeID = normalizeString(args.runtimeID);
  if (!runtimeID) throw new Error("runtimeID is required");
  await requireOnlineRuntime(runtimeID);

  const maxLen = normalizeList(args.list, 10);
  const regex = normalizeString(args.regex) || undefined;
  const result = await requestSessionList(runtimeID, undefined, maxLen, regex);
  const list = result.sessions.map((item) => ({
    name: item.title || item.id,
    id: item.id,
    time: typeof item.time === "string" ? item.time : "",
  }));
  return { realsize: result.meta.matched, list };
}
