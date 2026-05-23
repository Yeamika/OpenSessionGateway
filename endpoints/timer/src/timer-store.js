import { randomUUID } from "node:crypto";
import { nextCronTriggerAt } from "./cron.js";

export function createTimerService({ onFire, now = () => Date.now(), scheduler = defaultScheduler() }) {
  const rows = new Map();
  const handles = new Map();

  function list(input = {}) {
    return [...rows.values()]
      .filter((row) => !input.runtimeID || row.RuntimeID === input.runtimeID)
      .filter((row) => !input.sessionID || row.SessionID === input.sessionID)
      .sort((a, b) => a.triggerAt.localeCompare(b.triggerAt))
      .map(view);
  }

  function create(input) {
    requireText(input.runtimeID, "runtimeID");
    requireText(input.sessionID, "sessionID");
    requireText(input.msg, "msg");
    const row = makeRow(input, now());
    rows.set(row.TimerID, row);
    schedule(row);
    return view(row);
  }

  function deleteTimer(input) {
    const timerID = requireText(input.timerID, "timerID");
    const row = rows.get(timerID);
    if (!row || row.RuntimeID !== input.runtimeID || row.SessionID !== input.sessionID) {
      return { ok: false, deleted: false, timerID, error: "TimerID not found for runtime/session" };
    }
    clear(timerID);
    rows.delete(timerID);
    return { ok: true, deleted: true, timerID };
  }

  function clear(timerID) {
    const handle = handles.get(timerID);
    if (handle) scheduler.clear(handle);
    handles.delete(timerID);
  }

  function get(timerID) {
    const row = rows.get(timerID);
    return row ? view(row) : null;
  }

  async function fireNow(timerID) {
    await fire(timerID);
  }

  function schedule(row) {
    clear(row.TimerID);
    const delay = Math.max(0, new Date(row.triggerAt).getTime() - now());
    handles.set(row.TimerID, scheduler.set(() => fire(row.TimerID), delay));
  }

  async function fire(timerID) {
    clear(timerID);
    const row = rows.get(timerID);
    if (!row) return;
    try {
      await onFire(view(row));
      row.status = "pending";
      row.lastError = undefined;
    } catch (error) {
      row.status = "waiting_runtime";
      row.lastError = error instanceof Error ? error.message : String(error);
    }
    if (row.TimerType === "one_shot") rows.delete(timerID);
    else {
      row.triggerAt = nextRecurring(row, now());
      schedule(row);
    }
  }

  return { list, create, deleteTimer, get, fireNow };
}

function makeRow(input, nowMs = Date.now()) {
  const type = input.timerType || "one_shot";
  const seconds = type === "periodic"
    ? positive(input.everySeconds, "everySeconds")
    : type === "cron"
      ? 0
      : positive(input.afterSeconds, "afterSeconds");
  const cronExpr = type === "cron" ? requireText(input.cronExpr, "cronExpr") : undefined;
  return {
    TimerID: `timer-${randomUUID()}`,
    RuntimeID: input.runtimeID,
    SessionID: input.sessionID,
    ExecutorRuntimeID: input.ExecutorRuntimeID,
    ExecutorSessionID: input.ExecutorSessionID,
    Title: input.title || defaultTitle(type),
    MSG: input.msg,
    TimerType: type,
    DelaySeconds: type === "cron" ? 0 : seconds,
    EverySeconds: type === "periodic" ? seconds : undefined,
    CronExpr: cronExpr,
    createdAt: new Date(nowMs).toISOString(),
    triggerAt: type === "cron" ? nextCronTriggerAt(cronExpr, nowMs) : new Date(nowMs + seconds * 1000).toISOString(),
    status: "pending",
  };
}

function nextRecurring(row, nowMs) {
  if (row.TimerType === "cron") return nextCronTriggerAt(row.CronExpr, nowMs);
  return new Date(nowMs + positive(row.EverySeconds, "EverySeconds") * 1000).toISOString();
}

function view(row) {
  return { ...row };
}

function positive(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${name} must be a positive integer`);
  return number;
}

function requireText(value, name) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${name} is required`);
  return text;
}

function defaultTitle(type) {
  if (type === "periodic") return "periodic timer";
  if (type === "cron") return "cron timer";
  return "timer task";
}

function defaultScheduler() {
  return { set: (fn, delay) => setTimeout(fn, delay), clear: (handle) => clearTimeout(handle) };
}
