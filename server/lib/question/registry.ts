import type { QuestionStatus } from "@/lib/question/model";
import {
  applyQuestionAsked,
  applyQuestionUpdated,
  createRuntimeQuestionRecord,
  hydrateRuntimeQuestionRecord,
  type QuestionAskedPayload,
  type QuestionUpdatedPayload,
  type RuntimeQuestionRecord,
} from "@/lib/question/model";

const globalForQuestionRegistry = globalThis as unknown as {
  __osgQuestionRegistry?: Map<string, RuntimeQuestionRecord>;
};

if (!globalForQuestionRegistry.__osgQuestionRegistry) {
  globalForQuestionRegistry.__osgQuestionRegistry = new Map<string, RuntimeQuestionRecord>();
}

const registry = globalForQuestionRegistry.__osgQuestionRegistry;

function keyOf(runtimeID: string, questionID: string): string {
  return `${runtimeID.trim()}::${questionID.trim()}`;
}

function sortQuestions(rows: RuntimeQuestionRecord[]): RuntimeQuestionRecord[] {
  return [...rows].sort((a, b) => {
    const pendingA = a.status === "created" || a.status === "pending" ? 1 : 0;
    const pendingB = b.status === "created" || b.status === "pending" ? 1 : 0;
    if (pendingA !== pendingB) return pendingB - pendingA;
    const updated = b.updatedAt.localeCompare(a.updatedAt);
    if (updated !== 0) return updated;
    return a.questionID.localeCompare(b.questionID);
  });
}

export function getRuntimeQuestion(runtimeID: string, questionID: string): RuntimeQuestionRecord | null {
  const runtime = runtimeID.trim();
  const question = questionID.trim();
  if (!runtime || !question) return null;
  const hit = registry.get(keyOf(runtime, question));
  return hit ? hydrateRuntimeQuestionRecord(hit) : null;
}

export function listRuntimeQuestions(runtimeID: string, filters?: { sessionID?: string; status?: QuestionStatus }): RuntimeQuestionRecord[] {
  const runtime = runtimeID.trim();
  const sessionID = filters?.sessionID?.trim() || "";
  const status = filters?.status;
  if (!runtime) return [];
  return sortQuestions(
    [...registry.values()]
      .filter((row) => row.runtimeID === runtime)
      .filter((row) => (sessionID ? row.sessionID === sessionID : true))
      .filter((row) => (status ? row.status === status : true))
      .map(hydrateRuntimeQuestionRecord),
  );
}

export function upsertQuestionAsked(runtimeID: string, payload: QuestionAskedPayload): RuntimeQuestionRecord {
  const runtime = runtimeID.trim();
  const questionID = payload.questionID.trim();
  if (!runtime) throw new Error("runtimeID is required");
  if (!questionID) throw new Error("questionID is required");
  const key = keyOf(runtime, questionID);
  const existing = registry.get(key);
  const record = existing
    ? applyQuestionAsked(hydrateRuntimeQuestionRecord(existing), payload)
    : createRuntimeQuestionRecord(runtime, payload);
  registry.set(key, record);
  return record;
}

export function upsertQuestionUpdated(runtimeID: string, payload: QuestionUpdatedPayload): RuntimeQuestionRecord {
  const runtime = runtimeID.trim();
  const questionID = payload.questionID.trim();
  if (!runtime) throw new Error("runtimeID is required");
  if (!questionID) throw new Error("questionID is required");
  const key = keyOf(runtime, questionID);
  const existing = registry.get(key);
  const record = existing
    ? applyQuestionUpdated(hydrateRuntimeQuestionRecord(existing), payload)
    : applyQuestionUpdated(
        createRuntimeQuestionRecord(runtime, {
          questionID,
          sessionID: payload.sessionID,
          displayID: null,
          title: questionID,
          questions: [],
          detail: null,
          requestedAt: payload.updatedAt,
          correlationID: payload.correlationID,
          dedupeKey: null,
        }),
        payload,
      );
  registry.set(key, record);
  return record;
}

export function clearRuntimeQuestions(runtimeID: string): void {
  const runtime = runtimeID.trim();
  if (!runtime) return;
  for (const [key, value] of registry.entries()) {
    if (value.runtimeID === runtime) registry.delete(key);
  }
}
