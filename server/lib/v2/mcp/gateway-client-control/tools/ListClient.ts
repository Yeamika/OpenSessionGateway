import { listRuntimeClients } from "@/lib/runtime-store";
import { readV2RuntimeCurrentStatus } from "@/lib/v2/ws";

export const LIST_CLIENT_TOOL = {
  name: "ListClient",
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

function normalizeList(value: unknown, fallback = 10): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

function busyLabel(value: string | null): "idle" | "busy" {
  return (value || "").trim().toLowerCase() === "busy" ? "busy" : "idle";
}

export async function handleListClientTool(args: Record<string, unknown>) {
  const maxLen = normalizeList(args.list, 10);
  const clients = await listRuntimeClients();
  const online = clients.filter((item) => item.status === "online");
  const list = online.map((item) => ({
    runtimeID: item.runtimeID,
    title: item.title || "",
    sessionID: item.sessionID || "",
    currentStatus: busyLabel(readV2RuntimeCurrentStatus(item.runtimeID)),
  }));
  return { realsize: list.length, list: list.slice(0, maxLen) };
}
