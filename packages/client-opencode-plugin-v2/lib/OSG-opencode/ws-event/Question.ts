import {
  createQuestionAskedPayload,
  createQuestionUpdatedPayload,
  readReplyQuestionRequestPayload,
  type QuestionReplyType,
} from "@opensessiongateway/protocol-library";
import { resolveTargetSessionContext } from "../runtime/target-context.js";

type QueryFactory = () => Record<string, unknown>;

function client(ctx: any): any {
  return ctx?.client?._client;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function readTime(value: unknown): string {
  const direct = text(value);
  if (direct) return direct;
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  return new Date().toISOString();
}

function displayID(query: QueryFactory): string | null {
  const value = text(query()?.displayID);
  return value || null;
}

function source(event: Record<string, unknown>): Record<string, unknown> {
  const props = record(event.properties);
  const candidates = [record(props.question), record(props.request), record(props.info), props];
  return candidates.find((item) => Object.keys(item).length > 0) || {};
}

function questions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = record(item);
    const question = text(row.question);
    if (!question) return [];
    const options = Array.isArray(row.options)
      ? row.options.flatMap((entry) => {
        const option = record(entry);
        const label = text(option.label);
        if (!label) return [];
        return [{ label, description: text(option.description) || undefined }];
      })
      : [];
    return [{
      header: text(row.header),
      question,
      options,
      multiple: row.multiple === true ? true : undefined,
      custom: row.custom === true ? true : undefined,
    }];
  });
}

function answers(value: unknown): string[][] | null {
  if (!Array.isArray(value)) return null;
  return value.map((item) => Array.isArray(item) ? item.map((entry) => text(entry)).filter(Boolean) : []);
}

function ok(value: unknown): boolean {
  if (value === true) return true;
  const src = record(value);
  return src.data === true;
}

export function buildQuestionAskedPayload(input: {
  event: Record<string, unknown>;
  query: QueryFactory;
}) {
  const src = source(input.event);
  const questionID = text(src.questionID || src.id || src.requestID);
  const sessionID = text(src.sessionID);
  const list = questions(src.questions);
  if (!questionID || !sessionID || list.length === 0) return null;
  return createQuestionAskedPayload({
    questionID,
    sessionID,
    displayID: displayID(input.query),
    title: text(src.title) || list[0]?.header || list[0]?.question || "Question",
    questions: list,
    detail: { eventType: text(input.event.type) || "question.asked", event: input.event, properties: record(input.event.properties) },
    requestedAt: readTime(src.requestedAt || src.createdAt || input.event.time),
    correlationID: text(src.correlationID || src.correlationId) || questionID,
    dedupeKey: text(src.dedupeKey) || null,
  });
}

export function buildQuestionUpdatedPayload(input: {
  event: Record<string, unknown>;
  status: "answered" | "rejected" | "failed";
}) {
  const src = source(input.event);
  const questionID = text(src.questionID || src.id || src.requestID);
  if (!questionID) return null;
  return createQuestionUpdatedPayload({
    questionID,
    sessionID: text(src.sessionID) || null,
    status: input.status,
    updatedAt: readTime(src.updatedAt || input.event.time),
    answers: answers(src.answers),
    correlationID: text(src.correlationID || src.correlationId) || null,
  });
}

export async function handleReplyQuestionRequest(ctx: any, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const req = readReplyQuestionRequestPayload(payload);
  if (!req.questionID) {
    return { ok: false, questionID: "", replyType: req.replyType, error: "questionID is required" };
  }

  try {
    const raw = client(ctx);
    if (!raw) {
      return { ok: false, questionID: req.questionID, replyType: req.replyType, error: "question client unavailable" };
    }
    const target = req.sessionID ? await resolveTargetSessionContext(ctx, req.sessionID) : null;
    const query = target?.instanceWorkspaceDirectory
      ? { directory: target.instanceWorkspaceDirectory }
      : ctx?.directory
        ? { directory: ctx.directory }
        : undefined;
    if (req.replyType === "reject") {
      if (typeof raw.post !== "function") {
        return { ok: false, questionID: req.questionID, replyType: req.replyType, error: "question reject client unavailable" };
      }
      const response = await Promise.resolve(raw.post({
        url: `/question/${encodeURIComponent(req.questionID)}/reject`,
        query,
      }));
      if (!ok(response)) {
        return { ok: false, questionID: req.questionID, replyType: req.replyType, error: "question reject failed" };
      }
      return { ok: true, questionID: req.questionID, replyType: req.replyType };
    }
    if (typeof raw.post !== "function") {
      return { ok: false, questionID: req.questionID, replyType: req.replyType, error: "question reply client unavailable" };
    }
    const response = await Promise.resolve(raw.post({
      url: `/question/${encodeURIComponent(req.questionID)}/reply`,
      query,
      headers: { "Content-Type": "application/json" },
      body: { answers: req.answers || [] },
    }));
    if (!ok(response)) {
      return { ok: false, questionID: req.questionID, replyType: req.replyType, error: "question reply failed" };
    }
    return { ok: true, questionID: req.questionID, replyType: req.replyType };
  } catch (error) {
    return {
      ok: false,
      questionID: req.questionID,
      replyType: req.replyType,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildQuestionResolvedPayload(input: {
  questionID: string;
  sessionID?: string | null;
  replyType: QuestionReplyType;
  answers?: string[][] | null;
  actor?: string | null;
  reason?: string | null;
  correlationID?: string | null;
  ok: boolean;
  error?: string | null;
}) {
  return createQuestionUpdatedPayload({
    questionID: input.questionID,
    sessionID: input.sessionID || null,
    status: input.ok ? (input.replyType === "reject" ? "rejected" : "answered") : "failed",
    updatedAt: new Date().toISOString(),
    answers: input.answers || null,
    actor: input.actor || null,
    reason: input.reason || null,
    message: input.error || null,
    correlationID: input.correlationID || null,
  });
}
