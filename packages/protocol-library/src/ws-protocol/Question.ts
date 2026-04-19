export const QUESTION_ASKED_EVENT = "QuestionAsked";
export const QUESTION_UPDATED_EVENT = "QuestionUpdated";
export const REPLY_QUESTION_REQUEST_EVENT = "ReplyQuestionRequest";

export type QuestionStatus = "created" | "pending" | "answered" | "rejected" | "failed";

export type QuestionReplyType = "answer" | "reject";

export type QuestionOption = {
  label: string;
  description?: string;
};

export type QuestionInfo = {
  header: string;
  question: string;
  options: QuestionOption[];
  multiple?: boolean;
  custom?: boolean;
};

export type QuestionAskedPayload = {
  questionID: string;
  sessionID: string | null;
  displayID: string | null;
  title: string;
  questions: QuestionInfo[];
  detail: unknown;
  requestedAt: string;
  correlationID: string | null;
  dedupeKey: string | null;
};

export type QuestionUpdatedPayload = {
  questionID: string;
  sessionID: string | null;
  status: QuestionStatus;
  updatedAt: string;
  answers: string[][] | null;
  actor: string | null;
  reason: string | null;
  message: string | null;
  correlationID: string | null;
};

export type ReplyQuestionRequestPayload = {
  questionID: string;
  sessionID: string | null;
  replyType: QuestionReplyType;
  answers: string[][] | null;
  reason: string | null;
  actor: string | null;
  correlationID: string | null;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function maybe(value: unknown): string | null {
  const valueText = text(value);
  return valueText || null;
}

function stamp(value: unknown): string {
  return text(value) || new Date().toISOString();
}

function replyType(value: unknown): QuestionReplyType {
  return text(value) === "reject" ? "reject" : "answer";
}

function status(value: unknown): QuestionStatus {
  switch (text(value)) {
    case "created":
    case "answered":
    case "rejected":
    case "failed":
      return text(value) as QuestionStatus;
    default:
      return "pending";
  }
}

function options(value: unknown): QuestionOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const label = text(row.label);
    if (!label) return [];
    return [{
      label,
      description: text(row.description) || undefined,
    }];
  });
}

function infos(value: unknown): QuestionInfo[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const question = text(row.question);
    if (!question) return [];
    return [{
      header: text(row.header),
      question,
      options: options(row.options),
      multiple: row.multiple === true ? true : undefined,
      custom: row.custom === true ? true : undefined,
    }];
  });
}

function answers(value: unknown): string[][] | null {
  if (!Array.isArray(value)) return null;
  return value.map((item) => Array.isArray(item) ? item.map((entry) => text(entry)).filter(Boolean) : []);
}

export function createQuestionAskedPayload(input: {
  questionID?: string;
  sessionID?: string | null;
  displayID?: string | null;
  title?: string;
  questions?: QuestionInfo[];
  detail?: unknown;
  requestedAt?: string;
  correlationID?: string | null;
  dedupeKey?: string | null;
}): QuestionAskedPayload {
  return {
    questionID: text(input.questionID),
    sessionID: maybe(input.sessionID),
    displayID: maybe(input.displayID),
    title: text(input.title),
    questions: infos(input.questions),
    detail: input.detail === undefined ? null : input.detail,
    requestedAt: stamp(input.requestedAt),
    correlationID: maybe(input.correlationID),
    dedupeKey: maybe(input.dedupeKey),
  };
}

export function readQuestionAskedPayload(raw: unknown): QuestionAskedPayload {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return createQuestionAskedPayload({
    questionID: src.questionID as string | undefined,
    sessionID: src.sessionID as string | null | undefined,
    displayID: src.displayID as string | null | undefined,
    title: src.title as string | undefined,
    questions: src.questions as QuestionInfo[] | undefined,
    detail: src.detail,
    requestedAt: src.requestedAt as string | undefined,
    correlationID: src.correlationID as string | null | undefined,
    dedupeKey: src.dedupeKey as string | null | undefined,
  });
}

export function createQuestionUpdatedPayload(input: {
  questionID?: string;
  sessionID?: string | null;
  status?: QuestionStatus;
  updatedAt?: string;
  answers?: string[][] | null;
  actor?: string | null;
  reason?: string | null;
  message?: string | null;
  correlationID?: string | null;
}): QuestionUpdatedPayload {
  return {
    questionID: text(input.questionID),
    sessionID: maybe(input.sessionID),
    status: status(input.status),
    updatedAt: stamp(input.updatedAt),
    answers: answers(input.answers),
    actor: maybe(input.actor),
    reason: maybe(input.reason),
    message: maybe(input.message),
    correlationID: maybe(input.correlationID),
  };
}

export function readQuestionUpdatedPayload(raw: unknown): QuestionUpdatedPayload {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return createQuestionUpdatedPayload({
    questionID: src.questionID as string | undefined,
    sessionID: src.sessionID as string | null | undefined,
    status: src.status as QuestionStatus | undefined,
    updatedAt: src.updatedAt as string | undefined,
    answers: src.answers as string[][] | null | undefined,
    actor: src.actor as string | null | undefined,
    reason: src.reason as string | null | undefined,
    message: src.message as string | null | undefined,
    correlationID: src.correlationID as string | null | undefined,
  });
}

export function createReplyQuestionRequestPayload(input: {
  questionID?: string;
  sessionID?: string | null;
  replyType?: QuestionReplyType;
  answers?: string[][] | null;
  reason?: string | null;
  actor?: string | null;
  correlationID?: string | null;
}): ReplyQuestionRequestPayload {
  return {
    questionID: text(input.questionID),
    sessionID: maybe(input.sessionID),
    replyType: replyType(input.replyType),
    answers: answers(input.answers),
    reason: maybe(input.reason),
    actor: maybe(input.actor),
    correlationID: maybe(input.correlationID),
  };
}

export function readReplyQuestionRequestPayload(raw: unknown): ReplyQuestionRequestPayload {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return createReplyQuestionRequestPayload({
    questionID: src.questionID as string | undefined,
    sessionID: src.sessionID as string | null | undefined,
    replyType: src.replyType as QuestionReplyType | undefined,
    answers: src.answers as string[][] | null | undefined,
    reason: src.reason as string | null | undefined,
    actor: src.actor as string | null | undefined,
    correlationID: src.correlationID as string | null | undefined,
  });
}
