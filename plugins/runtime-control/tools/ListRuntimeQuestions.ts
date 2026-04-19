import { normalizeList, normalizeQuestionStatus, normalizeString } from "../common.js";
import type { RuntimeControlServices } from "../types.js";

export const LIST_RUNTIME_QUESTIONS_TOOL = {
  name: "ListRuntimeQuestions",
  description: "List known question items of one runtime",
  inputSchema: {
    type: "object",
    properties: {
      runtimeID: { type: "string", pattern: "\\S", description: "Target client runtimeID" },
      sessionID: { type: "string", description: "Optional sessionID filter" },
      status: {
        type: "string",
        enum: ["created", "pending", "answered", "rejected", "failed"],
        description: "Optional status filter",
      },
      list: { type: "number", description: "Maximum length to return. Default: 20" },
    },
    required: ["runtimeID"],
    additionalProperties: false,
  },
};

export function createListRuntimeQuestionsToolHandler(services: RuntimeControlServices) {
  return async function handleListRuntimeQuestionsTool(args: Record<string, unknown>) {
    const runtimeID = normalizeString(args.runtimeID);
    const sessionID = normalizeString(args.sessionID) || undefined;
    const status = normalizeQuestionStatus(args.status) || undefined;
    const maxLen = normalizeList(args.list, 20);
    return services.osg.listRuntimeQuestions({ runtimeID, sessionID, status, list: maxLen });
  };
}
