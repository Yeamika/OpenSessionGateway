export type QuestionStatus = "created" | "pending" | "answered" | "rejected" | "failed";

export type QuestionInfo = {
  header: string;
  question: string;
  options: Array<{ label: string; description?: string }>;
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

export type RuntimeQuestionRecord = {
  questionID: string;
  runtimeID: string;
  sessionID: string | null;
  displayID: string | null;
  title: string;
  questions: QuestionInfo[];
  detail: unknown;
  status: QuestionStatus;
  requestedAt: string;
  updatedAt: string;
  answeredAt: string | null;
  answers: string[][] | null;
  actor: string | null;
  reason: string | null;
  message: string | null;
  correlationID: string | null;
  dedupeKey: string | null;
};

export function createRuntimeQuestionRecord(runtimeID: string, payload: QuestionAskedPayload): RuntimeQuestionRecord {
  const now = payload.requestedAt || new Date().toISOString();
  return {
    questionID: payload.questionID.trim(),
    runtimeID: runtimeID.trim(),
    sessionID: payload.sessionID,
    displayID: payload.displayID,
    title: payload.title,
    questions: Array.isArray(payload.questions) ? payload.questions : [],
    detail: payload.detail,
    status: "created",
    requestedAt: now,
    updatedAt: now,
    answeredAt: null,
    answers: null,
    actor: null,
    reason: null,
    message: null,
    correlationID: payload.correlationID,
    dedupeKey: payload.dedupeKey,
  };
}

export function hydrateRuntimeQuestionRecord(record: RuntimeQuestionRecord): RuntimeQuestionRecord {
  record.questionID = record.questionID.trim();
  record.runtimeID = record.runtimeID.trim();
  record.sessionID = typeof record.sessionID === "string" && record.sessionID.trim() ? record.sessionID.trim() : null;
  record.displayID = typeof record.displayID === "string" && record.displayID.trim() ? record.displayID.trim() : null;
  record.title = typeof record.title === "string" ? record.title.trim() : "";
  record.answeredAt = typeof record.answeredAt === "string" && record.answeredAt.trim() ? record.answeredAt.trim() : null;
  record.actor = typeof record.actor === "string" && record.actor.trim() ? record.actor.trim() : null;
  record.reason = typeof record.reason === "string" && record.reason.trim() ? record.reason.trim() : null;
  record.message = typeof record.message === "string" && record.message.trim() ? record.message.trim() : null;
  record.correlationID = typeof record.correlationID === "string" && record.correlationID.trim() ? record.correlationID.trim() : null;
  record.dedupeKey = typeof record.dedupeKey === "string" && record.dedupeKey.trim() ? record.dedupeKey.trim() : null;
  record.questions = Array.isArray(record.questions) ? record.questions : [];
  record.answers = Array.isArray(record.answers)
    ? record.answers.map((item) => Array.isArray(item) ? item.map((entry) => String(entry).trim()).filter(Boolean) : [])
    : null;
  return record;
}

export function applyQuestionAsked(record: RuntimeQuestionRecord, payload: QuestionAskedPayload): RuntimeQuestionRecord {
  record.sessionID = payload.sessionID;
  record.displayID = payload.displayID;
  record.title = payload.title;
  record.questions = Array.isArray(payload.questions) ? payload.questions : [];
  record.detail = payload.detail;
  record.requestedAt = payload.requestedAt;
  record.updatedAt = payload.requestedAt;
  record.correlationID = payload.correlationID;
  record.dedupeKey = payload.dedupeKey;
  return hydrateRuntimeQuestionRecord(record);
}

export function applyQuestionUpdated(record: RuntimeQuestionRecord, payload: QuestionUpdatedPayload): RuntimeQuestionRecord {
  if (payload.sessionID) record.sessionID = payload.sessionID;
  record.status = payload.status;
  record.updatedAt = payload.updatedAt;
  record.answers = payload.answers;
  record.actor = payload.actor;
  record.reason = payload.reason;
  record.message = payload.message;
  record.correlationID = payload.correlationID || record.correlationID;
  if (payload.status === "answered" || payload.status === "rejected") {
    record.answeredAt = payload.updatedAt;
  }
  return hydrateRuntimeQuestionRecord(record);
}
