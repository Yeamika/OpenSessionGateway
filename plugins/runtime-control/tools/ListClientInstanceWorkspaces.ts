import { normalizeList, normalizeRegex, normalizeString } from "../common.js";
import type { RuntimeControlServices } from "../types.js";

export const LIST_CLIENT_INSTANCE_WORKSPACES_TOOL = {
  name: "ListClientInstanceWorkspaces",
  description: "List known InstanceWorkspaces of one client runtime",
  inputSchema: {
    type: "object",
    properties: {
      runtimeID: { type: "string", pattern: "\\S", description: "Target client runtimeID" },
      list: { type: "number", description: "Maximum length to return. Default: 20" },
      regex: { type: "string", description: "Regex filter for instanceWorkspaceDirectory/title. Default: empty" },
    },
    required: ["runtimeID"],
    additionalProperties: false,
  },
};

export function createListClientInstanceWorkspacesToolHandler(services: RuntimeControlServices) {
  return async function handleListClientInstanceWorkspacesTool(args: Record<string, unknown>) {
    const runtimeID = normalizeString(args.runtimeID);
    await services.osg.requireOnlineRuntime(runtimeID);

    const maxLen = normalizeList(args.list, 20);
    const regex = normalizeRegex(args.regex);

    const list = (await services.osg.listRuntimeInstanceWorkspaces(runtimeID))
      .filter((item) => {
        if (!regex) return true;
        const text = `${item.instanceWorkspaceDirectory || ""}\n${item.title || ""}`;
        return regex.test(text);
      })
      .map((item) => ({
        instanceWorkspaceDirectory: item.instanceWorkspaceDirectory || "",
        title: item.title || "",
      }));

    return { realsize: list.length, list: list.slice(0, maxLen) };
  };
}
