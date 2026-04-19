import { normalizeString } from "../common.js";
import type { RuntimeControlServices } from "../types.js";

export const GET_RUNTIME_QUESTION_TOOL = {
  name: "GetRuntimeQuestion",
  description: "Get one known question item of a runtime",
  inputSchema: {
    type: "object",
    properties: {
      runtimeID: { type: "string", pattern: "\\S", description: "Target client runtimeID" },
      questionID: { type: "string", pattern: "\\S", description: "Target questionID" },
    },
    required: ["runtimeID", "questionID"],
    additionalProperties: false,
  },
};

export function createGetRuntimeQuestionToolHandler(services: RuntimeControlServices) {
  return async function handleGetRuntimeQuestionTool(args: Record<string, unknown>) {
    const runtimeID = normalizeString(args.runtimeID);
    const questionID = normalizeString(args.questionID);
    return services.osg.getRuntimeQuestion({ runtimeID, questionID });
  };
}
