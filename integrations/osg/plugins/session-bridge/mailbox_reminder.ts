import type { SessionStatusChangeEvent, SessionStatusSnapshot } from "@opensessiongateway/server-plugin-sdk";

import type { SessionBridgeServices } from "./types.js";

import type { PluginMailboxRow } from "./mailbox.js";
import { normalizeRows, readSessionRows, writeSessionRows, createReminderPrompt, createReminderFingerprint, normalizeReminderState } from "./mailbox.js";

const MAILBOX_INITIAL_REMINDER_MS = 10_000;
const MAILBOX_REPEAT_REMINDER_MS = 60_000;
const MAILBOX_RETRY_MS = 5_000;
const MAILBOX_MAX_REPEAT_REMINDERS = 3;
const MAILBOX_BUSY_STATUS_CHANGE_DELAY = 10;
const MAILBOX_REMINDER_USER_MSG = "[OSG-Mailbox-Reminder]";
const MAILBOX_SESSION_PREFIX = "mailbox:session:";
const MAILBOX_REMINDER_PREFIX = "mailbox:reminder:";

type MailboxInfoType = "Notice" | "NeedReplay" | "QuestReply" | "Replaied";

export type MailboxReminderState = {
  lastReminderAt: string | null;
  lastUnreadCount: number;
  lastNeedReplayCount: number;
  lastPendingFingerprint: string;
  repeatReminderCount: number;
  hold:
    | { mode: "busy"; remainingChanges: number }
    | { mode: "waiting"; waitingReason: "permission" | "question" | null }
    | { mode: "failed"; reason: string; failureCount: number }
    | null;
};

type ReminderSnapshot = {
  runtimeStatus: "online" | "offline";
  sessionState: "idle" | "busy" | "waiting" | "stopped" | null;
  sessionReason:
    | "completed"
    | "pending"
    | "tool"
    | "generating"
    | "reasoning"
    | "compacting"
    | "permission"
    | "question"
    | "aborted"
    | "error"
    | null;
};

type ReminderDecision =
  | { mode: "idle" }
  | { mode: "busy" }
  | { mode: "waiting"; waitingReason: "permission" | "question" | null }
  | { mode: "failed"; reason: string };

const reminderTimers = new Map<string, ReturnType<typeof setTimeout>>();
const reminderWatchers = new Map<string, () => void>();

function reminderTimerKey(runtimeID: string, sessionID: string): string {
  return `${runtimeID.trim()}::${sessionID.trim()}`;
}

function sessionReminderKey(runtimeID: string, sessionID: string): string {
  return `${MAILBOX_REMINDER_PREFIX}${runtimeID.trim()}::${sessionID.trim()}`;
}

function sessionMailboxBucketSessionID(key: string): string {
  const rest = key.startsWith(MAILBOX_SESSION_PREFIX) ? key.slice(MAILBOX_SESSION_PREFIX.length) : "";
  if (!rest || rest.includes("::")) return "";
  return rest.trim();
}

function reminderWatchKey(runtimeID: string, sessionID: string): string {
  return `${runtimeID.trim()}::${sessionID.trim()}`;
}

function clearMailboxReminder(runtimeID: string, sessionID: string): void {
  const key = reminderTimerKey(runtimeID, sessionID);
  const timer = reminderTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    reminderTimers.delete(key);
  }
}

function clearMailboxReminderWatch(runtimeID: string, sessionID: string): void {
  const key = reminderWatchKey(runtimeID, sessionID);
  const off = reminderWatchers.get(key);
  if (!off) return;
  reminderWatchers.delete(key);
  off();
}

export function clearMailboxReminderResources(runtimeID: string, sessionID: string): void {
  clearMailboxReminder(runtimeID, sessionID);
  clearMailboxReminderWatch(runtimeID, sessionID);
}

function setBusyHold(state: MailboxReminderState): void {
  state.hold = { mode: "busy", remainingChanges: MAILBOX_BUSY_STATUS_CHANGE_DELAY };
}

function setWaitingHold(state: MailboxReminderState, waitingReason: "permission" | "question" | null): void {
  state.hold = { mode: "waiting", waitingReason };
}

function setFailedHold(state: MailboxReminderState, reason: string): void {
  const failureCount = state.hold?.mode === "failed" ? state.hold.failureCount + 1 : 1;
  state.hold = { mode: "failed", reason: reason.trim() || "delivery_failed", failureCount };
}

async function readPendingReminderRows(
  services: SessionBridgeServices,
  runtimeID: string,
  sessionID: string,
): Promise<PluginMailboxRow[]> {
  return (await readSessionRows(services, sessionID))
    .filter((item) => item.recipientRuntimeID === runtimeID)
    .filter((item) => (item.recipientSessionID || "") === sessionID);
}

async function readReminderSnapshot(
  services: SessionBridgeServices,
  runtimeID: string,
  sessionID: string,
): Promise<ReminderSnapshot> {
  const runtimeOnline = await services.osg.hasOnlineRuntime(runtimeID).catch(() => false);
  if (!runtimeOnline) {
    return { runtimeStatus: "offline", sessionState: null, sessionReason: null };
  }
  const list = await services.osg.listRuntimeManagedSessions(runtimeID).catch(() => []);
  const hit = list.find((item) => item.sessionID === sessionID) || null;
  return {
    runtimeStatus: "online",
    sessionState: hit?.state ?? null,
    sessionReason: hit?.reason ?? null,
  };
}

function reminderSnapshotFromEvent(current: SessionStatusSnapshot): ReminderSnapshot {
  return {
    runtimeStatus: current.runtimeStatus,
    sessionState: current.sessionState,
    sessionReason: current.sessionReason,
  };
}

function decideReminderMode(snapshot: ReminderSnapshot): ReminderDecision {
  if (snapshot.runtimeStatus !== "online") {
    return { mode: "failed", reason: "runtime_offline" };
  }
  if (snapshot.sessionState === "idle") {
    return { mode: "idle" };
  }
  if (snapshot.sessionState === "busy") {
    return { mode: "busy" };
  }
  if (snapshot.sessionState === "waiting") {
    if (snapshot.sessionReason === "permission" || snapshot.sessionReason === "question") {
      return { mode: "waiting", waitingReason: snapshot.sessionReason };
    }
    return { mode: "waiting", waitingReason: null };
  }
  if (snapshot.sessionState === "stopped") {
    return { mode: "failed", reason: snapshot.sessionReason || "stopped" };
  }
  return { mode: "failed", reason: snapshot.sessionReason || snapshot.sessionState || "session_unknown" };
}

function syncMailboxReminderWatch(services: SessionBridgeServices, runtimeID: string, sessionID: string, state: MailboxReminderState): void {
  if (!state.hold) {
    clearMailboxReminderWatch(runtimeID, sessionID);
    return;
  }
  const key = reminderWatchKey(runtimeID, sessionID);
  if (reminderWatchers.has(key)) return;
  const off = services.watchSessionStatus(
    { runtimeID, sessionID },
    { emitCurrent: true },
    (event) => {
      void handleMailboxReminderSessionStatusChange(services, runtimeID, sessionID, event);
    },
  );
  reminderWatchers.set(key, off);
}

async function handleMailboxReminderSessionStatusChange(
  services: SessionBridgeServices,
  runtimeID: string,
  sessionID: string,
  event: SessionStatusChangeEvent,
): Promise<void> {
  const rows = await readPendingReminderRows(services, runtimeID, sessionID);
  if (rows.length === 0) {
    clearMailboxReminderResources(runtimeID, sessionID);
    return;
  }

  const reminder = await readReminderState(services, runtimeID, sessionID);
  if (!reminder.hold) {
    clearMailboxReminderWatch(runtimeID, sessionID);
    return;
  }

  const next = decideReminderMode(reminderSnapshotFromEvent(event.current));

  if (reminder.hold.mode === "busy") {
    if (next.mode === "failed") {
      setFailedHold(reminder, next.reason);
      await writeReminderState(services, runtimeID, sessionID, reminder);
      syncMailboxReminderWatch(services, runtimeID, sessionID, reminder);
      scheduleMailboxReminderWithDelay(services, runtimeID, sessionID, MAILBOX_RETRY_MS);
      return;
    }
    if (next.mode === "waiting") {
      setWaitingHold(reminder, next.waitingReason);
      await writeReminderState(services, runtimeID, sessionID, reminder);
      syncMailboxReminderWatch(services, runtimeID, sessionID, reminder);
      return;
    }
    if (event.kind === "snapshot") return;
    const remainingChanges = Math.max(0, reminder.hold.remainingChanges - 1);
    reminder.hold = { mode: "busy", remainingChanges };
    await writeReminderState(services, runtimeID, sessionID, reminder);
    syncMailboxReminderWatch(services, runtimeID, sessionID, reminder);
    if (remainingChanges > 0) return;
    reminder.hold = null;
    await writeReminderState(services, runtimeID, sessionID, reminder);
    scheduleMailboxReminder(services, runtimeID, sessionID);
    return;
  }

  if (reminder.hold.mode === "waiting") {
    if (next.mode === "waiting" && next.waitingReason === reminder.hold.waitingReason) return;
    if (next.mode === "failed") {
      setFailedHold(reminder, next.reason);
      await writeReminderState(services, runtimeID, sessionID, reminder);
      syncMailboxReminderWatch(services, runtimeID, sessionID, reminder);
      scheduleMailboxReminderWithDelay(services, runtimeID, sessionID, MAILBOX_RETRY_MS);
      return;
    }
    reminder.hold = null;
    await writeReminderState(services, runtimeID, sessionID, reminder);
    scheduleMailboxReminder(services, runtimeID, sessionID);
    return;
  }

  if (reminder.hold.mode === "failed") {
    if (next.mode === "failed") {
      scheduleMailboxReminderWithDelay(services, runtimeID, sessionID, MAILBOX_RETRY_MS);
      return;
    }
    reminder.hold = null;
    await writeReminderState(services, runtimeID, sessionID, reminder);
    scheduleMailboxReminder(services, runtimeID, sessionID);
  }
}

async function readReminderState(services: SessionBridgeServices, runtimeID: string, sessionID: string): Promise<MailboxReminderState> {
  return normalizeReminderState(await services.storage.get(sessionReminderKey(runtimeID, sessionID)));
}

async function writeReminderState(
  services: SessionBridgeServices,
  runtimeID: string,
  sessionID: string,
  state: MailboxReminderState,
): Promise<void> {
  await services.storage.set(sessionReminderKey(runtimeID, sessionID), state);
}

function scheduleMailboxReminderWithDelay(
  services: SessionBridgeServices,
  runtimeID: string,
  sessionID: string,
  delayMs: number,
): void {
  const runtime = runtimeID.trim();
  const session = sessionID.trim();
  if (!runtime || !session) return;
  clearMailboxReminder(runtime, session);
  const timer = setTimeout(() => {
    reminderTimers.delete(reminderTimerKey(runtime, session));
    void processMailboxReminder(services, runtime, session);
  }, Math.max(0, delayMs));
  reminderTimers.set(reminderTimerKey(runtime, session), timer);
}

export function scheduleMailboxReminder(services: SessionBridgeServices, runtimeID: string, sessionID: string): void {
  scheduleMailboxReminderWithDelay(services, runtimeID, sessionID, 0);
}

export async function processMailboxReminder(
  services: SessionBridgeServices,
  runtimeID: string,
  sessionID: string,
): Promise<void> {
  const rows = await readPendingReminderRows(services, runtimeID, sessionID);
  const reminder = await readReminderState(services, runtimeID, sessionID);
  const unreadRows = rows
    .filter((item) => item.hasRead === false)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const unrepliedRows = rows
    .filter((item) => item.mailType === "NeedReplay" && item.infoType === "NeedReplay")
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const reminderRows = rows
    .filter((item) => item.hasRead === false || (item.mailType === "NeedReplay" && item.infoType === "NeedReplay"))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const unreadCount = unreadRows.length;
  const unrepliedCount = unrepliedRows.length;
  const addedCount = Math.max(0, unreadCount - reminder.lastUnreadCount);
  const pendingFingerprint = createReminderFingerprint(reminderRows);
  const pendingChanged = reminder.lastPendingFingerprint !== pendingFingerprint;

  reminder.lastUnreadCount = unreadCount;
  reminder.lastNeedReplayCount = unrepliedCount;

  if (reminderRows.length === 0) {
    reminder.lastReminderAt = null;
    reminder.lastPendingFingerprint = "";
    reminder.repeatReminderCount = 0;
    reminder.hold = null;
    await writeReminderState(services, runtimeID, sessionID, reminder);
    clearMailboxReminderResources(runtimeID, sessionID);
    return;
  }

  if (pendingChanged) {
    reminder.lastPendingFingerprint = pendingFingerprint;
    reminder.lastReminderAt = null;
    reminder.repeatReminderCount = 0;
    reminder.hold = null;
  }

  const newest = reminderRows[0];
  const nowMs = Date.now();
  const ageMs = nowMs - new Date(newest.createdAt).getTime();
  const lastReminderAtMs = reminder.lastReminderAt ? new Date(reminder.lastReminderAt).getTime() : Number.NaN;
  const prompt = createReminderPrompt({ unreadCount, unrepliedCount, addedCount, items: reminderRows });

  try {
    const hasPriorReminder = Number.isFinite(lastReminderAtMs);
    const reminderDueMs = hasPriorReminder
      ? lastReminderAtMs + MAILBOX_REPEAT_REMINDER_MS
      : new Date(newest.createdAt).getTime() + MAILBOX_INITIAL_REMINDER_MS;

    if (reminderDueMs <= nowMs) {
      if (!pendingChanged && reminder.repeatReminderCount >= MAILBOX_MAX_REPEAT_REMINDERS) {
        reminder.lastReminderAt = new Date(nowMs).toISOString();
        reminder.hold = null;
        await writeReminderState(services, runtimeID, sessionID, reminder);
        clearMailboxReminderResources(runtimeID, sessionID);
        return;
      }

      const decision = decideReminderMode(await readReminderSnapshot(services, runtimeID, sessionID));
      if (decision.mode === "busy") {
        setBusyHold(reminder);
        await writeReminderState(services, runtimeID, sessionID, reminder);
        syncMailboxReminderWatch(services, runtimeID, sessionID, reminder);
        clearMailboxReminder(runtimeID, sessionID);
        return;
      }
      if (decision.mode === "waiting") {
        setWaitingHold(reminder, decision.waitingReason);
        await writeReminderState(services, runtimeID, sessionID, reminder);
        syncMailboxReminderWatch(services, runtimeID, sessionID, reminder);
        clearMailboxReminder(runtimeID, sessionID);
        return;
      }
      if (decision.mode === "failed") {
        setFailedHold(reminder, decision.reason);
        await writeReminderState(services, runtimeID, sessionID, reminder);
        syncMailboxReminderWatch(services, runtimeID, sessionID, reminder);
        scheduleMailboxReminderWithDelay(services, runtimeID, sessionID, MAILBOX_RETRY_MS);
        return;
      }

      const result = await services.osg.addPrompt({
        runtimeID,
        sessionID,
        msg: MAILBOX_REMINDER_USER_MSG,
        system: prompt,
      });
      if (!result.ok) {
        throw new Error(result.error || "mailbox reminder prompt submit failed");
      }
      reminder.lastReminderAt = new Date(nowMs).toISOString();
      reminder.repeatReminderCount = pendingChanged ? 1 : reminder.repeatReminderCount + 1;
      reminder.hold = null;
      await writeReminderState(services, runtimeID, sessionID, reminder);
      syncMailboxReminderWatch(services, runtimeID, sessionID, reminder);
      scheduleMailboxReminderWithDelay(services, runtimeID, sessionID, MAILBOX_REPEAT_REMINDER_MS);
      return;
    }

    reminder.hold = null;
    await writeReminderState(services, runtimeID, sessionID, reminder);
    syncMailboxReminderWatch(services, runtimeID, sessionID, reminder);
    const nextDelay = hasPriorReminder
      ? Math.max(0, reminderDueMs - nowMs)
      : Math.max(0, MAILBOX_INITIAL_REMINDER_MS - ageMs);
    scheduleMailboxReminderWithDelay(services, runtimeID, sessionID, nextDelay);
  } catch (error) {
    setFailedHold(reminder, error instanceof Error ? error.message : String(error));
    await writeReminderState(services, runtimeID, sessionID, reminder);
    syncMailboxReminderWatch(services, runtimeID, sessionID, reminder);
    services.log("warn", "mailbox reminder deferred", {
      runtimeID,
      sessionID,
      hold: reminder.hold,
    });
    scheduleMailboxReminderWithDelay(services, runtimeID, sessionID, MAILBOX_RETRY_MS);
  }
}

export async function restoreMailboxReminders(services: SessionBridgeServices): Promise<void> {
  const entries = await services.storage.list<PluginMailboxRow[]>(MAILBOX_SESSION_PREFIX);
  const scheduled = new Set<string>();
  for (const entry of entries) {
    const sessionID = sessionMailboxBucketSessionID(entry.key);
    if (!sessionID) continue;
    const rows = normalizeRows(entry.value);
    const runtimeIDs = new Set(rows.map((row) => row.recipientRuntimeID).filter(Boolean));
    for (const runtimeID of runtimeIDs) {
      const key = `${runtimeID}::${sessionID}`;
      if (scheduled.has(key)) continue;
      scheduled.add(key);
      scheduleMailboxReminder(services, runtimeID, sessionID);
    }
  }
}

export async function restoreMailboxRemindersForRuntime(
  services: SessionBridgeServices,
  runtimeID: string,
): Promise<void> {
  const entries = await services.storage.list<PluginMailboxRow[]>(MAILBOX_SESSION_PREFIX);
  for (const entry of entries) {
    const sessionID = sessionMailboxBucketSessionID(entry.key);
    if (!sessionID) continue;
    const rows = normalizeRows(entry.value);
    if (!rows.some((row) => row.recipientRuntimeID === runtimeID)) continue;
    scheduleMailboxReminder(services, runtimeID, sessionID);
  }
}

export function clearAllMailboxReminderTimers(): void {
  for (const timer of reminderTimers.values()) {
    clearTimeout(timer);
  }
  reminderTimers.clear();
}

export function clearAllMailboxReminderWatchers(): void {
  for (const off of reminderWatchers.values()) {
    off();
  }
  reminderWatchers.clear();
}
