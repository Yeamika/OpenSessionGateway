import { normalizeQuestionReplyType, normalizeString } from "../common.js";
import type { RuntimeControlServices } from "../types.js";

function answers(value: unknown): string[][] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => Array.isArray(item) ? item.map((entry) => normalizeString(entry)).filter(Boolean) : []);
}

export const REPLY_RUNTIME_QUESTION_TOOL = {
  name: "ReplyRuntimeQuestion",
  description: "Reply one pending question item through a target runtime",
  inputSchema: {
    type: "object",
    properties: {
      runtimeID: { type: "string", pattern: "\\S", description: "Target client runtimeID" },
      questionID: { type: "string", pattern: "\\S", description: "Target questionID" },
      replyType: {
        type: "string",
        enum: ["answer", "reject"],
        description: "Question reply type",
      },
      answers: {
        type: "array",
        description: "Answer rows in question order; required when replyType=answer",
        items: { type: "array", items: { type: "string" } },
      },
      reason: { type: "string", description: "Optional reply reason" },
      actor: { type: "string", description: "Optional controller identity" },
      correlationID: { type: "string", description: "Optional correlation id" },
    },
    required: ["runtimeID", "questionID", "replyType"],
    additionalProperties: false,
  },
};

export function createReplyRuntimeQuestionToolHandler(services: RuntimeControlServices) {
  return async function handleReplyRuntimeQuestionTool(args: Record<string, unknown>) {
    const runtimeID = normalizeString(args.runtimeID);
    const questionID = normalizeString(args.questionID);
    const replyType = normalizeQuestionReplyType(args.replyType);
    const replyAnswers = answers(args.answers);
    const reason = normalizeString(args.reason) || undefined;
    const actor = normalizeString(args.actor) || undefined;
    const correlationID = normalizeString(args.correlationID) || undefined;

    await services.osg.requireOnlineRuntime(runtimeID);

    return services.osg.replyRuntimeQuestion({
      runtimeID,
      questionID,
      replyType,
      answers: replyAnswers,
      reason,
      actor,
      correlationID,
    });
  };
}
