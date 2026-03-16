import { listRuntimeClients } from "@/lib/runtime-store";
import { readV2RuntimeCurrentStatus } from "@/lib/v2/ws";
import { busyLabel, normalizeList, normalizeRegex } from "../common";

export const LIST_LIVING_SESSION_TOOL = {
  name: "ListLivingSession",
  description: "Session gateway and network neighbors: list online sessions",
  inputSchema: {
    type: "object",
    properties: {
      list: {
        type: "number",
        description: "Maximum length to return. Default: 10",
      },
      regex: {
        type: "string",
        description: "Regex filter for runtimeID/sessionID/title. Default: empty",
      },
    },
    additionalProperties: false,
  },
};

export async function handleListLivingSessionTool(toolArgs: Record<string, unknown>, requesterRuntimeID: string) {
  const clients = await listRuntimeClients();
  const online = clients.filter((item) => item.status === "online");
  const regex = normalizeRegex(toolArgs.regex);
  const maxLen = normalizeList(toolArgs.list, 10);

  const matched = online
    .filter((item) => {
      if (!regex) return true;
      const text = `${item.runtimeID}\n${item.sessionID || ""}\n${item.title || ""}`;
      return regex.test(text);
    })
    .map((item) => ({
      runtimeID: item.runtimeID,
      title: item.title || "",
      sessionID: item.sessionID || "",
      currentStatus: busyLabel(readV2RuntimeCurrentStatus(item.runtimeID)),
    }));

  const requester = online.find((item) => item.runtimeID === requesterRuntimeID);
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
}
