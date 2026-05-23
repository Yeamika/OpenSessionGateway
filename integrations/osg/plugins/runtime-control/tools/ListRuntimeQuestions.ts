import { normalizeList, normalizeQuestionStatus, normalizeString } from "../common.js";
import type { RuntimeControlServices } from "../types.js";

export const LIST_RUNTIME_QUESTIONS_TOOL = {
  name: "ListRuntimeQuestions",
  description: "List known question items of one runtime, or show one detailed question by questionID",
  inputSchema: {
    type: "object",
    properties: {
      runtimeID: { type: "string", pattern: "\\S", description: "Target client runtimeID" },
      questionID: { type: "string", description: "Optional questionID; when provided, returns detailed info of one question" },
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
    const questionID = normalizeString(args.questionID) || undefined;
    const sessionID = normalizeString(args.sessionID) || undefined;
    const status = normalizeQuestionStatus(args.status) || undefined;
    const maxLen = normalizeList(args.list, 20);

    if (questionID) {
      return services.osg.getRuntimeQuestion({ runtimeID, questionID });
    }

    const result = await services.osg.listRuntimeQuestions({ runtimeID, sessionID, status, list: maxLen });
    return {
      realsize: result.realsize,
      list: result.list.map((item) => ({
        questionID: item.questionID,
        sessionID: item.sessionID,
        displayID: item.displayID,
        title: item.title,
        status: item.status,
        requestedAt: item.requestedAt,
        updatedAt: item.updatedAt,
      })),
    };
  };
}
