import { requireOnlineRuntime } from "@/lib/runtime-validation";
import { requestListAvailableModels } from "@/lib/v2/ws";

export const LIST_AVAILABLE_MODELS_TOOL = {
  name: "ListAvailableModels",
  description: "List available models of a runtime",
  inputSchema: {
    type: "object",
    properties: {
      runtimeID: { type: "string", description: "Target client runtimeID" },
      list: { type: "number", description: "Maximum length to return. Default: 10" },
      regex: { type: "string", description: "Regex filter for providerID/modelID/name. Default: empty" },
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

export async function handleListAvailableModelsTool(args: Record<string, unknown>) {
  const runtimeID = normalizeString(args.runtimeID);
  const regex = normalizeString(args.regex) || undefined;
  const maxLen = normalizeList(args.list, 10);

  if (!runtimeID) throw new Error("runtimeID is required");
  await requireOnlineRuntime(runtimeID);

  return requestListAvailableModels(runtimeID, maxLen, regex);
}
