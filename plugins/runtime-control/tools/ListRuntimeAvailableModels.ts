import { normalizeList, normalizeString } from "../common.js";
import type { RuntimeControlServices } from "../types.js";

export const LIST_RUNTIME_AVAILABLE_MODELS_TOOL = {
  name: "ListRuntimeAvailableModels",
  description: "List available models of one runtime",
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

export function createListRuntimeAvailableModelsToolHandler(services: RuntimeControlServices) {
  return async function handleListRuntimeAvailableModelsTool(args: Record<string, unknown>) {
    const runtimeID = normalizeString(args.runtimeID);
    const regex = normalizeString(args.regex) || undefined;
    const maxLen = normalizeList(args.list, 10);

    await services.osg.requireOnlineRuntime(runtimeID);

    return services.osg.listAvailableModels({ runtimeID, list: maxLen, regex });
  };
}
