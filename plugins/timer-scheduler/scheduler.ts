import { randomUUID } from "node:crypto";

import type { PluginContext } from "@opensessiongateway/server-plugin-sdk";

import type { TimerRow } from "./common.js";
import { normalizeString, normalizeTimerType, view, wrapTimer } from "./common.js";

const TIMER_PREFIX = "timer-scheduler:timer:";
const RETRY_DELAY_MS = 30_000;
const TIMER_TRIGGERED_USER_MSG = "[OSG-Timer-Triggered]";
const CRON_SCAN_LIMIT_MINUTES = 60 * 24 * 366 * 5;

const scheduledTimers = new Map<string, ReturnType<typeof setTimeout>>();

type ParsedCron = {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
};

function timerStorageKey(timerID: string): string {
  return `${TIMER_PREFIX}${timerID}`;
}

function clearScheduledTimer(timerID: string): void {
  const timer = scheduledTimers.get(timerID);
  if (!timer) return;
  clearTimeout(timer);
  scheduledTimers.delete(timerID);
}

function normalizeCronNumber(value: string, min: number, max: number, label: string, allowSunday7 = false): number {
  const text = value.trim();
  if (!/^\d+$/.test(text)) {
    throw new Error(`cron ${label} must use numbers, ranges, lists, or steps`);
  }
  const raw = Number(text);
  if (!Number.isInteger(raw)) {
    throw new Error(`cron ${label} is invalid`);
  }
  const normalized = allowSunday7 && raw === 7 ? 0 : raw;
  if (normalized < min || normalized > max) {
    throw new Error(`cron ${label} must be between ${min} and ${allowSunday7 ? 7 : max}`);
  }
  return normalized;
}

function addCronRange(target: Set<number>, start: number, end: number, step: number, label: string): void {
  if (!Number.isInteger(step) || step <= 0) {
    throw new Error(`cron ${label} step must be a positive integer`);
  }
  if (start > end) {
    throw new Error(`cron ${label} range is invalid`);
  }
  for (let value = start; value <= end; value += step) {
    target.add(value);
  }
}

function parseCronField(
  source: string,
  min: number,
  max: number,
  label: string,
  allowSunday7 = false,
): Set<number> {
  const values = new Set<number>();
  const tokens = source.split(",").map((item) => item.trim()).filter(Boolean);
  if (tokens.length === 0) {
    throw new Error(`cron ${label} is required`);
  }

  for (const token of tokens) {
    const [baseRaw, stepRaw, extraRaw] = token.split("/");
    if (extraRaw !== undefined) {
      throw new Error(`cron ${label} has too many step separators`);
    }
    const base = baseRaw.trim();
    const step = stepRaw === undefined ? 1 : normalizeCronNumber(stepRaw, 1, max - min + 1, `${label} step`);

    if (base === "*") {
      addCronRange(values, min, max, step, label);
      continue;
    }

    const dashIndex = base.indexOf("-");
    if (dashIndex >= 0) {
      const start = normalizeCronNumber(base.slice(0, dashIndex), min, max, label, allowSunday7);
      const end = normalizeCronNumber(base.slice(dashIndex + 1), min, max, label, allowSunday7);
      addCronRange(values, start, end, step, label);
      continue;
    }

    const start = normalizeCronNumber(base, min, max, label, allowSunday7);
    const end = stepRaw === undefined ? start : max;
    addCronRange(values, start, end, step, label);
  }

  return values;
}

function parseCronExpression(expr: string): ParsedCron {
  const source = normalizeString(expr);
  const fields = source.split(/\s+/).filter(Boolean);
  if (fields.length !== 5) {
    throw new Error("cronExpr must contain exactly 5 fields: minute hour day month weekday");
  }

  return {
    minutes: parseCronField(fields[0], 0, 59, "minute"),
    hours: parseCronField(fields[1], 0, 23, "hour"),
    daysOfMonth: parseCronField(fields[2], 1, 31, "day"),
    months: parseCronField(fields[3], 1, 12, "month"),
    weekdays: parseCronField(fields[4], 0, 6, "weekday", true),
  };
}

function matchesCron(parsed: ParsedCron, date: Date): boolean {
  return parsed.minutes.has(date.getUTCMinutes())
    && parsed.hours.has(date.getUTCHours())
    && parsed.daysOfMonth.has(date.getUTCDate())
    && parsed.months.has(date.getUTCMonth() + 1)
    && parsed.weekdays.has(date.getUTCDay());
}

function nextCronTriggerAt(cronExpr: string, afterMs: number): string {
  const parsed = parseCronExpression(cronExpr);
  const cursor = new Date(afterMs);
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  for (let i = 0; i < CRON_SCAN_LIMIT_MINUTES; i += 1) {
    if (matchesCron(parsed, cursor)) {
      return cursor.toISOString();
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }

  throw new Error("cronExpr has no matching trigger within 5 years");
}

function nextPeriodicTriggerAt(row: TimerRow, fromMs: number): string {
  const everySeconds = Number(row.EverySeconds ?? row.DelaySeconds);
  if (!Number.isInteger(everySeconds) || everySeconds <= 0) {
    throw new Error("periodic timer requires EverySeconds");
  }

  const intervalMs = everySeconds * 1000;
  const currentTriggerAtMs = new Date(row.triggerAt).getTime();
  if (!Number.isFinite(currentTriggerAtMs)) {
    return new Date(fromMs + intervalMs).toISOString();
  }

  if (currentTriggerAtMs > fromMs) {
    return new Date(currentTriggerAtMs).toISOString();
  }

  const steps = Math.floor((fromMs - currentTriggerAtMs) / intervalMs) + 1;
  return new Date(currentTriggerAtMs + steps * intervalMs).toISOString();
}

function normalizeTimerRow(value: unknown): TimerRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<TimerRow>;
  const timerID = normalizeString(row.TimerID);
  const runtimeID = normalizeString(row.RuntimeID);
  const sessionID = normalizeString(row.SessionID);
  const title = typeof row.Title === "string" ? row.Title : "";
  const msg = typeof row.MSG === "string" ? row.MSG : "";
  const createdAt = typeof row.createdAt === "string" ? row.createdAt : "";
  const triggerAt = typeof row.triggerAt === "string" ? row.triggerAt : "";
  const timerType = normalizeTimerType(row.TimerType);
  const delaySeconds = Number(row.DelaySeconds);
  const everySeconds = row.EverySeconds === undefined ? undefined : Number(row.EverySeconds);
  const cronExpr = typeof row.CronExpr === "string" ? row.CronExpr.trim() : "";
  if (!timerID || !runtimeID || !sessionID || !createdAt || !triggerAt || !Number.isFinite(delaySeconds) || delaySeconds < 0) {
    return null;
  }

  if (timerType === "periodic") {
    const periodicEvery = Number.isInteger(everySeconds) && Number(everySeconds) > 0
      ? Number(everySeconds)
      : Number.isInteger(delaySeconds) && delaySeconds > 0
        ? delaySeconds
        : NaN;
    if (!Number.isInteger(periodicEvery) || periodicEvery <= 0) return null;
    return {
      TimerID: timerID,
      RuntimeID: runtimeID,
      SessionID: sessionID,
      Title: title,
      MSG: msg,
      TimerType: "periodic",
      DelaySeconds: periodicEvery,
      EverySeconds: periodicEvery,
      createdAt,
      triggerAt,
      status: row.status === "waiting_runtime" ? "waiting_runtime" : "pending",
      lastError: typeof row.lastError === "string" && row.lastError.trim() ? row.lastError : undefined,
    };
  }

  if (timerType === "cron") {
    if (!cronExpr) return null;
    try {
      parseCronExpression(cronExpr);
    } catch {
      return null;
    }
    return {
      TimerID: timerID,
      RuntimeID: runtimeID,
      SessionID: sessionID,
      Title: title,
      MSG: msg,
      TimerType: "cron",
      DelaySeconds: 0,
      CronExpr: cronExpr,
      createdAt,
      triggerAt,
      status: row.status === "waiting_runtime" ? "waiting_runtime" : "pending",
      lastError: typeof row.lastError === "string" && row.lastError.trim() ? row.lastError : undefined,
    };
  }

  if (!Number.isInteger(delaySeconds) || delaySeconds <= 0) {
    return null;
  }

  return {
    TimerID: timerID,
    RuntimeID: runtimeID,
    SessionID: sessionID,
    Title: title,
    MSG: msg,
    TimerType: "one_shot",
    DelaySeconds: delaySeconds,
    createdAt,
    triggerAt,
    status: row.status === "waiting_runtime" ? "waiting_runtime" : "pending",
    lastError: typeof row.lastError === "string" && row.lastError.trim() ? row.lastError : undefined,
  };
}

async function readTimer(context: PluginContext, timerID: string): Promise<TimerRow | null> {
  return normalizeTimerRow(await context.storage.get(timerStorageKey(timerID)));
}

async function writeTimer(context: PluginContext, row: TimerRow): Promise<void> {
  await context.storage.set(timerStorageKey(row.TimerID), row);
}

async function deleteTimerStorage(context: PluginContext, timerID: string): Promise<void> {
  clearScheduledTimer(timerID);
  await context.storage.delete(timerStorageKey(timerID));
}

function scheduleRetry(context: PluginContext, timerID: string, delayMs: number): void {
  clearScheduledTimer(timerID);
  const handle = setTimeout(() => {
    scheduledTimers.delete(timerID);
    void fireTimer(context, timerID);
  }, Math.max(0, Number.isFinite(delayMs) ? delayMs : 0));
  scheduledTimers.set(timerID, handle);
}

function scheduleTimer(context: PluginContext, row: TimerRow): void {
  const triggerAtMs = new Date(row.triggerAt).getTime();
  const delayMs = Number.isFinite(triggerAtMs) ? Math.max(0, triggerAtMs - Date.now()) : 0;
  scheduleRetry(context, row.TimerID, delayMs);
}

function nextRecurringTriggerAt(row: TimerRow, fromMs: number): string {
  if (row.TimerType === "periodic") {
    return nextPeriodicTriggerAt(row, fromMs);
  }
  if (row.TimerType === "cron" && row.CronExpr) {
    return nextCronTriggerAt(row.CronExpr, fromMs);
  }
  throw new Error(`timer ${row.TimerID} is not recurring`);
}

export async function listTimers(context: PluginContext, input: {
  runtimeID: string;
  sessionID: string;
}): Promise<ReturnType<typeof view>[]> {
  const entries = await context.storage.list<TimerRow>(TIMER_PREFIX);
  return entries
    .map((entry) => normalizeTimerRow(entry.value))
    .filter((row): row is TimerRow => Boolean(row))
    .filter((row) => row.RuntimeID === input.runtimeID && row.SessionID === input.sessionID)
    .sort((a, b) => a.triggerAt.localeCompare(b.triggerAt))
    .map(view);
}

export async function listAllTimers(context: PluginContext): Promise<ReturnType<typeof view>[]> {
  const entries = await context.storage.list<TimerRow>(TIMER_PREFIX);
  return entries
    .map((entry) => normalizeTimerRow(entry.value))
    .filter((row): row is TimerRow => Boolean(row))
    .sort((a, b) => a.triggerAt.localeCompare(b.triggerAt))
    .map(view);
}

async function fireTimer(context: PluginContext, timerID: string): Promise<void> {
  clearScheduledTimer(timerID);
  const row = await readTimer(context, timerID);
  if (!row) return;

  const triggerAtMs = new Date(row.triggerAt).getTime();
  if (Number.isFinite(triggerAtMs) && triggerAtMs > Date.now()) {
    scheduleTimer(context, row);
    return;
  }

  try {
    await context.osg.requireOnlineRuntimeSession(row.RuntimeID, row.SessionID);
    await context.osg.addPrompt({
      runtimeID: row.RuntimeID,
      sessionID: row.SessionID,
      msg: TIMER_TRIGGERED_USER_MSG,
      system: wrapTimer(row),
    });
  } catch (error) {
    row.status = "waiting_runtime";
    row.lastError = error instanceof Error ? error.message : String(error);
    await writeTimer(context, row);
    scheduleRetry(context, row.TimerID, RETRY_DELAY_MS);
    return;
  }

  if (row.TimerType === "one_shot") {
    await deleteTimerStorage(context, row.TimerID);
    return;
  }

  try {
    row.triggerAt = nextRecurringTriggerAt(row, Date.now());
    row.status = "pending";
    row.lastError = undefined;
    await writeTimer(context, row);
    scheduleTimer(context, row);
  } catch (error) {
    row.status = "waiting_runtime";
    row.lastError = error instanceof Error ? error.message : String(error);
    await writeTimer(context, row);
  }
}

function createBaseRow(input: {
  runtimeID: string;
  sessionID: string;
  title: string;
  msg: string;
  timerType: TimerRow["TimerType"];
  delaySeconds: number;
  everySeconds?: number;
  cronExpr?: string;
  triggerAt: string;
}): TimerRow {
  return {
    TimerID: `timer-${randomUUID()}`,
    RuntimeID: input.runtimeID,
    SessionID: input.sessionID,
    Title: input.title,
    MSG: input.msg,
    TimerType: input.timerType,
    DelaySeconds: input.delaySeconds,
    EverySeconds: input.everySeconds,
    CronExpr: input.cronExpr,
    createdAt: new Date().toISOString(),
    triggerAt: input.triggerAt,
    status: "pending",
  };
}

export async function createOneShotTimer(context: PluginContext, input: {
  runtimeID: string;
  sessionID: string;
  title: string;
  msg: string;
  afterSeconds: number;
}): Promise<ReturnType<typeof view>> {
  await context.osg.requireOnlineRuntimeSession(input.runtimeID, input.sessionID);

  const now = Date.now();
  const row = createBaseRow({
    runtimeID: input.runtimeID,
    sessionID: input.sessionID,
    title: input.title,
    msg: input.msg,
    timerType: "one_shot",
    delaySeconds: input.afterSeconds,
    triggerAt: new Date(now + input.afterSeconds * 1000).toISOString(),
  });

  await writeTimer(context, row);
  scheduleTimer(context, row);
  return view(row);
}

export async function createPeriodicTimer(context: PluginContext, input: {
  runtimeID: string;
  sessionID: string;
  title: string;
  msg: string;
  everySeconds: number;
}): Promise<ReturnType<typeof view>> {
  await context.osg.requireOnlineRuntimeSession(input.runtimeID, input.sessionID);

  const now = Date.now();
  const row = createBaseRow({
    runtimeID: input.runtimeID,
    sessionID: input.sessionID,
    title: input.title,
    msg: input.msg,
    timerType: "periodic",
    delaySeconds: input.everySeconds,
    everySeconds: input.everySeconds,
    triggerAt: new Date(now + input.everySeconds * 1000).toISOString(),
  });

  await writeTimer(context, row);
  scheduleTimer(context, row);
  return view(row);
}

export async function createCronTimer(context: PluginContext, input: {
  runtimeID: string;
  sessionID: string;
  title: string;
  msg: string;
  cronExpr: string;
}): Promise<ReturnType<typeof view>> {
  await context.osg.requireOnlineRuntimeSession(input.runtimeID, input.sessionID);

  const now = Date.now();
  const cronExpr = normalizeString(input.cronExpr);
  const row = createBaseRow({
    runtimeID: input.runtimeID,
    sessionID: input.sessionID,
    title: input.title,
    msg: input.msg,
    timerType: "cron",
    delaySeconds: 0,
    cronExpr,
    triggerAt: nextCronTriggerAt(cronExpr, now),
  });

  await writeTimer(context, row);
  scheduleTimer(context, row);
  return view(row);
}

export async function deleteRuntimeTimer(context: PluginContext, input: {
  runtimeID: string;
  sessionID: string;
  timerID: string;
}): Promise<{ ok: boolean; deleted: boolean; timerID: string; error?: string }> {
  const timerID = normalizeString(input.timerID);
  const row = await readTimer(context, timerID);
  if (!row || row.RuntimeID !== input.runtimeID || row.SessionID !== input.sessionID) {
    return {
      ok: false,
      deleted: false,
      timerID,
      error: "TimerID not found for runtime/session",
    };
  }

  await deleteTimerStorage(context, timerID);
  return {
    ok: true,
    deleted: true,
    timerID,
  };
}

export async function restoreAllTimers(context: PluginContext): Promise<void> {
  const entries = await context.storage.list<TimerRow>(TIMER_PREFIX);
  for (const entry of entries) {
    const row = normalizeTimerRow(entry.value);
    if (!row) continue;
    scheduleTimer(context, row);
  }
}

export async function restoreTimersForRuntime(context: PluginContext, runtimeID: string): Promise<void> {
  const runtime = runtimeID.trim();
  if (!runtime) return;
  const entries = await context.storage.list<TimerRow>(TIMER_PREFIX);
  for (const entry of entries) {
    const row = normalizeTimerRow(entry.value);
    if (!row || row.RuntimeID !== runtime) continue;
    scheduleTimer(context, row);
  }
}

export function disposeTimers(): void {
  for (const handle of scheduledTimers.values()) {
    clearTimeout(handle);
  }
  scheduledTimers.clear();
}
