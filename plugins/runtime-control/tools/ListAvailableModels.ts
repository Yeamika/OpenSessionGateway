import { normalizeList, normalizeString } from "../common.ts";
import type { RuntimeControlServices } from "../types.ts";

export const LIST_AVAILABLE_MODELS_TOOL = {
  name: "ListAvailableModels",
  description: "List available models of a runtime",
  inputSchema: {
    type: "object",
    properties: {
      runtimeID: { type: "string", pattern: "\\S", description: "Target client runtimeID" },
      list: { type: "number", description: "Maximum length to return. Default: 10" },
      regex: { type: "string", description: "Regex filter for providerID/modelID/name. Default: empty" },
    },
    required: ["runtimeID"],
    additionalProperties: false,
  },
};

export function createListAvailableModelsToolHandler(services: RuntimeControlServices) {
  return async function handleListAvailableModelsTool(args: Record<string, unknown>) {
    const runtimeID = normalizeString(args.runtimeID);
    const regex = normalizeString(args.regex) || undefined;
    const maxLen = normalizeList(args.list, 10);

    await services.osg.requireOnlineRuntime(runtimeID);

    return services.osg.listAvailableModels({ runtimeID, list: maxLen, regex });
  };
}
