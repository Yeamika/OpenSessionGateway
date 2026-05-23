import { randomUUID } from "node:crypto";

import type { SessionBridgeServices } from "./types.js";

import {
  scheduleMailboxReminder,
  clearMailboxReminderResources,
} from "./mailbox_reminder.js";

const MAILBOX_SESSION_PREFIX = "mailbox:session:";
const MAILBOX_TOAST_DISPLAY_ID = "placeholder";
const MAILBOX_TOAST_DURATION_MS = 5_000;
const MAILBOX_BUSY_STATUS_CHANGE_DELAY = 10;

type MailboxMailType = "Notice" | "NeedReplay";
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

export function createReminderState(): MailboxReminderState {
  return {
    lastReminderAt: null,
    lastUnreadCount: 0,
    lastNeedReplayCount: 0,
    lastPendingFingerprint: "",
    repeatReminderCount: 0,
    hold: null,
  };
}

function normalizeHold(value: unknown): MailboxReminderState["hold"] {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const mode = typeof row.mode === "string" ? row.mode.trim() : "";
  if (mode === "busy") {
    const remainingChanges = Number.isInteger(row.remainingChanges) && Number(row.remainingChanges) >= 0
      ? Number(row.remainingChanges)
      : MAILBOX_BUSY_STATUS_CHANGE_DELAY;
    return { mode, remainingChanges };
  }
  if (mode === "waiting") {
    const waitingReason = row.waitingReason === "permission" || row.waitingReason === "question"
      ? row.waitingReason
      : null;
    return { mode, waitingReason };
  }
  if (mode === "failed") {
    const reason = typeof row.reason === "string" && row.reason.trim() ? row.reason.trim() : "delivery_failed";
    const failureCount = Number.isInteger(row.failureCount) && Number(row.failureCount) > 0 ? Number(row.failureCount) : 1;
    return { mode, reason, failureCount };
  }
  return null;
}

export function normalizeReminderState(value: unknown): MailboxReminderState {
  if (!value || typeof value !== "object") return createReminderState();
  const row = value as Partial<MailboxReminderState>;
  return {
    lastReminderAt: typeof row.lastReminderAt === "string" && row.lastReminderAt.trim() ? row.lastReminderAt.trim() : null,
    lastUnreadCount: Number.isInteger(row.lastUnreadCount) && Number(row.lastUnreadCount) >= 0 ? Number(row.lastUnreadCount) : 0,
    lastNeedReplayCount:
      Number.isInteger(row.lastNeedReplayCount) && Number(row.lastNeedReplayCount) >= 0 ? Number(row.lastNeedReplayCount) : 0,
    lastPendingFingerprint:
      typeof row.lastPendingFingerprint === "string" && row.lastPendingFingerprint.trim() ? row.lastPendingFingerprint.trim() : "",
    repeatReminderCount:
      Number.isInteger(row.repeatReminderCount) && Number(row.repeatReminderCount) >= 0 ? Number(row.repeatReminderCount) : 0,
    hold: normalizeHold(row.hold),
  };
}

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

type SessionMailboxBucket = {
  sessionID: string;
  rows: PluginMailboxRow[];
};

function sessionMailboxKey(sessionID: string): string {
  return `${MAILBOX_SESSION_PREFIX}${sessionID.trim()}`;
}

function sessionMailboxBucketSessionID(key: string): string {
  const rest = key.startsWith(MAILBOX_SESSION_PREFIX) ? key.slice(MAILBOX_SESSION_PREFIX.length) : "";
  if (!rest || rest.includes("::")) return "";
  return rest.trim();
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

export function normalizeRows(value: unknown): PluginMailboxRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeRow)
    .filter((item): item is PluginMailboxRow => Boolean(item));
}

export async function readSessionRows(services: SessionBridgeServices, sessionID: string): Promise<PluginMailboxRow[]> {
  return normalizeRows(await services.storage.get(sessionMailboxKey(sessionID)));
}

export async function writeSessionRows(
  services: SessionBridgeServices,
  sessionID: string,
  rows: PluginMailboxRow[],
): Promise<void> {
  await services.storage.set(sessionMailboxKey(sessionID), rows);
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

export function createReminderPrompt(input: {
  unreadCount: number;
  unrepliedCount: number;
  addedCount: number;
  items: PluginMailboxRow[];
}): string {
  const itemLines = input.items.slice(0, 5).map((item) => {
    const status = item.infoType === "NeedReplay"
      ? "needs_reply"
      : item.hasRead
        ? "read"
        : "unread";
    return `<item id="${item.id}" replayID="${item.replayID || ""}" infoType="${item.infoType}" status="${status}" sender="${item.senderSessionTitle || item.senderSessionID}">${item.title}</item>`;
  });
  return [
    "<OSG-Mailbox-Reminder>",
    `<unread>${input.unreadCount}</unread>`,
    `<unreplied>${input.unrepliedCount}</unreplied>`,
    `<newlyAdded>${input.addedCount}</newlyAdded>`,
    "<instruction>Call ListMailboxItems to inspect mailbox items, then call ReadMailboxItem for unread items and ReplyMailboxItem for pending replies when needed.</instruction>",
    "<important>If unreplied > 0, you MUST reply to every item whose infoType is NeedReplay. NeedReplay still requires ReplyMailboxItem even when hasRead=true. Do not answer \"无新邮件\" or \"same result\" while any NeedReplay item remains.</important>",
    "<pendingItems>",
    ...itemLines,
    "</pendingItems>",
    "</OSG-Mailbox-Reminder>",
  ].join("\n");
}

export function createReminderFingerprint(rows: PluginMailboxRow[]): string {
  return rows
    .map((item) => [item.id, item.infoType, item.hasRead ? "1" : "0", item.replayID || "", item.title].join("::"))
    .sort((a, b) => a.localeCompare(b))
    .join("||");
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

export async function deleteMailboxItem(input: {
  services: SessionBridgeServices;
  runtimeID: string;
  sessionID?: string;
  itemID: string;
}): Promise<{ ok: boolean; itemID: string; message: string }> {
  const buckets = await listRuntimeBuckets(input.services, input.runtimeID, input.sessionID);
  for (const bucket of buckets) {
    const index = bucket.rows.findIndex(
      (item) =>
        item.id === input.itemID &&
        (input.sessionID ? (item.recipientSessionID || "") === input.sessionID : item.recipientRuntimeID === input.runtimeID),
    );
    if (index === -1) continue;

    const removed = bucket.rows.splice(index, 1)[0];
    await writeSessionRows(input.services, bucket.sessionID, bucket.rows);
    scheduleMailboxReminder(input.services, removed.recipientRuntimeID, bucket.sessionID);
    return { ok: true, itemID: removed.id, message: "deleted" };
  }

  return { ok: false, itemID: input.itemID, message: "item not found" };
}

// Re-export reminder functions from the split module
export {
  scheduleMailboxReminder,
  processMailboxReminder,
  restoreMailboxReminders,
  restoreMailboxRemindersForRuntime,
  clearAllMailboxReminderTimers,
  clearAllMailboxReminderWatchers,
} from "./mailbox_reminder.js";
