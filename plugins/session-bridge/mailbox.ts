import { randomUUID } from "node:crypto";

import type { SessionBridgeServices } from "./types.ts";

const MAILBOX_INITIAL_REMINDER_MS = 10_000;
const MAILBOX_REPEAT_REMINDER_MS = 60_000;
const MAILBOX_RETRY_MS = 5_000;
const MAILBOX_REMINDER_USER_MSG = "[OSG-Mailbox-Reminder]";
const MAILBOX_TOAST_DISPLAY_ID = "placeholder";
const MAILBOX_TOAST_DURATION_MS = 5_000;
const MAILBOX_SESSION_PREFIX = "mailbox:session:";
const MAILBOX_REMINDER_PREFIX = "mailbox:reminder:";

type MailboxMailType = "Notice" | "NeedReplay";
type MailboxInfoType = "Notice" | "NeedReplay" | "QuestReply" | "Replaied";

export type PluginMailboxRow = {
  id: string;
  recipientRuntimeID: string;
  recipientSessionID: string | null;
  senderRuntimeID: string;
  senderSessionID: string;
  senderSessionTitle: string;
  mailType: MailboxMailType;
  infoType: MailboxInfoType;
  title: string;
  content: string;
  replayID: string | null;
  hasRead: boolean;
  createdAt: string;
};

type MailboxReminderState = {
  lastReminderAt: string | null;
  lastUnreadCount: number;
  lastNeedReplayCount: number;
};

type SessionMailboxBucket = {
  sessionID: string;
  rows: PluginMailboxRow[];
};

const reminderTimers = new Map<string, ReturnType<typeof setTimeout>>();

function reminderTimerKey(runtimeID: string, sessionID: string): string {
  return `${runtimeID.trim()}::${sessionID.trim()}`;
}

function sessionMailboxKey(sessionID: string): string {
  return `${MAILBOX_SESSION_PREFIX}${sessionID.trim()}`;
}

function sessionMailboxBucketSessionID(key: string): string {
  const rest = key.startsWith(MAILBOX_SESSION_PREFIX) ? key.slice(MAILBOX_SESSION_PREFIX.length) : "";
  if (!rest || rest.includes("::")) return "";
  return rest.trim();
}

function sessionReminderKey(runtimeID: string, sessionID: string): string {
  return `${MAILBOX_REMINDER_PREFIX}${runtimeID.trim()}::${sessionID.trim()}`;
}

function createReminderState(): MailboxReminderState {
  return {
    lastReminderAt: null,
    lastUnreadCount: 0,
    lastNeedReplayCount: 0,
  };
}

function normalizeRow(value: unknown): PluginMailboxRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<PluginMailboxRow>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const recipientRuntimeID = typeof row.recipientRuntimeID === "string" ? row.recipientRuntimeID.trim() : "";
  const senderRuntimeID = typeof row.senderRuntimeID === "string" ? row.senderRuntimeID.trim() : "";
  const senderSessionID = typeof row.senderSessionID === "string" ? row.senderSessionID.trim() : "";
  const senderSessionTitle = typeof row.senderSessionTitle === "string" ? row.senderSessionTitle : "";
  const title = typeof row.title === "string" ? row.title : "";
  const content = typeof row.content === "string" ? row.content : "";
  const createdAt = typeof row.createdAt === "string" ? row.createdAt : "";
  if (!id || !recipientRuntimeID || !senderRuntimeID || !senderSessionID || !createdAt) return null;
  return {
    id,
    recipientRuntimeID,
    recipientSessionID: typeof row.recipientSessionID === "string" && row.recipientSessionID.trim() ? row.recipientSessionID.trim() : null,
    senderRuntimeID,
    senderSessionID,
    senderSessionTitle,
    mailType: row.mailType === "NeedReplay" ? "NeedReplay" : "Notice",
    infoType:
      row.infoType === "NeedReplay" || row.infoType === "QuestReply" || row.infoType === "Replaied"
        ? row.infoType
        : "Notice",
    title,
    content,
    replayID: typeof row.replayID === "string" && row.replayID.trim() ? row.replayID.trim() : null,
    hasRead: row.hasRead === true,
    createdAt,
  };
}

function normalizeRows(value: unknown): PluginMailboxRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeRow)
    .filter((item): item is PluginMailboxRow => Boolean(item));
}

function normalizeReminderState(value: unknown): MailboxReminderState {
  if (!value || typeof value !== "object") return createReminderState();
  const row = value as Partial<MailboxReminderState>;
  return {
    lastReminderAt: typeof row.lastReminderAt === "string" && row.lastReminderAt.trim() ? row.lastReminderAt.trim() : null,
    lastUnreadCount: Number.isInteger(row.lastUnreadCount) && Number(row.lastUnreadCount) >= 0 ? Number(row.lastUnreadCount) : 0,
    lastNeedReplayCount:
      Number.isInteger(row.lastNeedReplayCount) && Number(row.lastNeedReplayCount) >= 0 ? Number(row.lastNeedReplayCount) : 0,
  };
}

async function readSessionRows(services: SessionBridgeServices, sessionID: string): Promise<PluginMailboxRow[]> {
  return normalizeRows(await services.storage.get(sessionMailboxKey(sessionID)));
}

async function writeSessionRows(
  services: SessionBridgeServices,
  sessionID: string,
  rows: PluginMailboxRow[],
): Promise<void> {
  await services.storage.set(sessionMailboxKey(sessionID), rows);
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

async function listRuntimeBuckets(
  services: SessionBridgeServices,
  runtimeID: string,
  sessionID?: string,
): Promise<SessionMailboxBucket[]> {
  const runtime = runtimeID.trim();
  const session = typeof sessionID === "string" ? sessionID.trim() : "";
  if (!runtime && !session) return [];

  if (session) {
    return [{ sessionID: session, rows: await readSessionRows(services, session) }];
  }

  const entries = await services.storage.list<PluginMailboxRow[]>(MAILBOX_SESSION_PREFIX);
  const merged = new Map<string, PluginMailboxRow[]>();
  for (const entry of entries) {
    const bucketSessionID = sessionMailboxBucketSessionID(entry.key);
    if (!bucketSessionID) continue;
    const rows = normalizeRows(entry.value);
    const current = merged.get(bucketSessionID) || [];
    const seen = new Set(current.map((row) => row.id));
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      current.push(row);
      seen.add(row.id);
    }
    merged.set(bucketSessionID, current);
  }

  return [...merged.entries()]
    .map(([bucketSessionID, rows]) => ({ sessionID: bucketSessionID, rows }))
    .filter((bucket) => bucket.rows.some((row) => row.recipientRuntimeID === runtime));
}

function toInfoType(row: PluginMailboxRow): string {
  if (row.infoType === "QuestReply" && row.replayID) {
    return `QuestReply(${row.replayID})`;
  }
  return row.infoType;
}

function createReminderPrompt(input: {
  unreadCount: number;
  unrepliedCount: number;
  addedCount: number;
}): string {
  return [
    "<OSG-Mailbox-Reminder>",
    `<unread>${input.unreadCount}</unread>`,
    `<unreplied>${input.unrepliedCount}</unreplied>`,
    `<newlyAdded>${input.addedCount}</newlyAdded>`,
    "<instruction>Call ListMailboxItems to inspect mailbox items, then call ReadMailboxItem for unread items and ReplyMailboxItem for pending replies when needed.</instruction>",
    "</OSG-Mailbox-Reminder>",
  ].join("\n");
}

function clearMailboxReminder(runtimeID: string, sessionID: string): void {
  const key = reminderTimerKey(runtimeID, sessionID);
  const timer = reminderTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    reminderTimers.delete(key);
  }
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
  const rows = (await readSessionRows(services, sessionID))
    .filter((item) => item.recipientRuntimeID === runtimeID)
    .filter((item) => (item.recipientSessionID || "") === sessionID);
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

  reminder.lastUnreadCount = unreadCount;
  reminder.lastNeedReplayCount = unrepliedCount;

  if (reminderRows.length === 0) {
    reminder.lastReminderAt = null;
    await writeReminderState(services, runtimeID, sessionID, reminder);
    clearMailboxReminder(runtimeID, sessionID);
    return;
  }

  const newest = reminderRows[0];
  const nowMs = Date.now();
  const ageMs = nowMs - new Date(newest.createdAt).getTime();
  const lastReminderAtMs = reminder.lastReminderAt ? new Date(reminder.lastReminderAt).getTime() : Number.NaN;
  const prompt = createReminderPrompt({ unreadCount, unrepliedCount, addedCount });

  try {
    const hasPriorReminder = Number.isFinite(lastReminderAtMs);
    const reminderDueMs = hasPriorReminder
      ? lastReminderAtMs + MAILBOX_REPEAT_REMINDER_MS
      : new Date(newest.createdAt).getTime() + MAILBOX_INITIAL_REMINDER_MS;

    if (reminderDueMs <= nowMs) {
      await services.osg.addPrompt({
        runtimeID,
        sessionID,
        msg: MAILBOX_REMINDER_USER_MSG,
        system: prompt,
      });
      reminder.lastReminderAt = new Date(nowMs).toISOString();
      await writeReminderState(services, runtimeID, sessionID, reminder);
      scheduleMailboxReminderWithDelay(services, runtimeID, sessionID, MAILBOX_REPEAT_REMINDER_MS);
      return;
    }

    await writeReminderState(services, runtimeID, sessionID, reminder);
    const nextDelay = hasPriorReminder
      ? Math.max(0, reminderDueMs - nowMs)
      : Math.max(0, MAILBOX_INITIAL_REMINDER_MS - ageMs);
    scheduleMailboxReminderWithDelay(services, runtimeID, sessionID, nextDelay);
  } catch {
    await writeReminderState(services, runtimeID, sessionID, reminder);
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

export async function sendMailboxItem(input: {
  services: SessionBridgeServices;
  recipientRuntimeID: string;
  recipientSessionID: string;
  senderRuntimeID: string;
  senderSessionID: string;
  senderSessionTitle: string;
  title: string;
  message: string;
  mailType: MailboxMailType;
}) {
  const id = randomUUID();
  const replayID = input.mailType === "NeedReplay" ? randomUUID() : null;
  const rows = await readSessionRows(input.services, input.recipientSessionID);

  rows.push({
    id,
    recipientRuntimeID: input.recipientRuntimeID,
    recipientSessionID: input.recipientSessionID || null,
    senderRuntimeID: input.senderRuntimeID,
    senderSessionID: input.senderSessionID,
    senderSessionTitle: input.senderSessionTitle,
    mailType: input.mailType,
    infoType: input.mailType,
    title: input.title,
    content: input.message,
    replayID,
    hasRead: false,
    createdAt: new Date().toISOString(),
  });

  await writeSessionRows(input.services, input.recipientSessionID, rows);
  await input.services.osg.showToast({
    runtimeID: input.recipientRuntimeID,
    displayID: MAILBOX_TOAST_DISPLAY_ID,
    title: "New Mail Received",
    message: `title=${input.title}`,
    subtitle: "Mailbox",
    variant: "info",
    durationMs: MAILBOX_TOAST_DURATION_MS,
  }).catch(() => {});
  scheduleMailboxReminder(input.services, input.recipientRuntimeID, input.recipientSessionID);
  return id;
}

export async function listMailboxItems(input: {
  services: SessionBridgeServices;
  runtimeID: string;
  sessionID?: string;
  size: number;
  regex?: string;
  metadataRegex?: string;
}) {
  const regex = typeof input.regex === "string" && input.regex.trim() ? new RegExp(input.regex) : null;
  const metadataRegex =
    typeof input.metadataRegex === "string" && input.metadataRegex.trim() ? new RegExp(input.metadataRegex) : null;

  const rows = (await listRuntimeBuckets(input.services, input.runtimeID, input.sessionID))
    .flatMap((bucket) => bucket.rows)
    .filter((row) => {
      if (input.sessionID) return (row.recipientSessionID || "") === input.sessionID;
      return row.recipientRuntimeID === input.runtimeID;
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const filtered = rows.filter((row) => {
    if (regex && !regex.test(`${row.title}\n${row.content}`)) return false;
    if (!metadataRegex) return true;
    const metaText = [
      row.createdAt,
      toInfoType(row),
      String(row.hasRead),
      row.senderSessionID,
      row.senderSessionTitle,
    ].join("\n");
    return metadataRegex.test(metaText);
  });

  return {
    realsize: filtered.length,
    list: filtered.slice(0, input.size).map((row) => ({
      ItemID: row.id,
      ReplayID: row.replayID,
      senderSessionID: row.senderSessionID,
      senderSessionTitle: row.senderSessionTitle,
      InfoType: toInfoType(row),
      hasRead: row.hasRead,
      title: row.title,
      times: row.createdAt,
    })),
  };
}

export async function markMailboxRead(input: {
  services: SessionBridgeServices;
  runtimeID: string;
  sessionID?: string;
  itemID: string;
}) {
  const buckets = await listRuntimeBuckets(input.services, input.runtimeID, input.sessionID);
  for (const bucket of buckets) {
    const row = bucket.rows.find(
      (item) =>
        item.id === input.itemID &&
        (input.sessionID ? (item.recipientSessionID || "") === input.sessionID : item.recipientRuntimeID === input.runtimeID),
    );
    if (!row) continue;

    row.hasRead = true;
    await writeSessionRows(input.services, bucket.sessionID, bucket.rows);
    scheduleMailboxReminder(input.services, row.recipientRuntimeID, bucket.sessionID);
    return {
      ItemID: row.id,
      ReplayID: row.replayID,
      senderRuntimeID: row.senderRuntimeID,
      senderSessionID: row.senderSessionID,
      senderSessionTitle: row.senderSessionTitle,
      InfoType: toInfoType(row),
      hasRead: row.hasRead,
      title: row.title,
      content: row.content,
      times: row.createdAt,
    };
  }

  return null;
}

export async function replayMailboxItem(input: {
  services: SessionBridgeServices;
  runtimeID: string;
  sessionID?: string;
  replayID: string;
  message: string;
  senderSessionID: string;
  senderSessionTitle: string;
}) {
  const buckets = await listRuntimeBuckets(input.services, input.runtimeID, input.sessionID);
  for (const bucket of buckets) {
    const original = bucket.rows.find(
      (item) =>
        (input.sessionID ? (item.recipientSessionID || "") === input.sessionID : item.recipientRuntimeID === input.runtimeID) &&
        item.mailType === "NeedReplay" &&
        item.infoType === "NeedReplay" &&
        item.replayID === input.replayID,
    );
    if (!original) continue;

    const id = randomUUID();
    const targetSessionID = original.senderSessionID || input.senderSessionID;
    const targetRows = await readSessionRows(input.services, targetSessionID);
    targetRows.push({
      id,
      recipientRuntimeID: original.senderRuntimeID,
      recipientSessionID: targetSessionID || null,
      senderRuntimeID: input.runtimeID,
      senderSessionID: input.senderSessionID,
      senderSessionTitle: input.senderSessionTitle,
      mailType: "Notice",
      infoType: "QuestReply",
      title: `Reply: ${original.title}`,
      content: input.message,
      replayID: original.replayID,
      hasRead: false,
      createdAt: new Date().toISOString(),
    });

    await writeSessionRows(input.services, targetSessionID, targetRows);
    await input.services.osg.showToast({
      runtimeID: original.senderRuntimeID,
      displayID: MAILBOX_TOAST_DISPLAY_ID,
      title: "New Mail Received",
      message: `title=Reply: ${original.title}`,
      subtitle: "Mailbox",
      variant: "info",
      durationMs: MAILBOX_TOAST_DURATION_MS,
    }).catch(() => {});
    scheduleMailboxReminder(input.services, original.senderRuntimeID, targetSessionID);

    original.infoType = "Replaied";
    await writeSessionRows(input.services, bucket.sessionID, bucket.rows);
    scheduleMailboxReminder(input.services, original.recipientRuntimeID, bucket.sessionID);
    return { ok: true, replayMailID: id };
  }

  return { ok: false, message: "ReplayID not found" };
}
