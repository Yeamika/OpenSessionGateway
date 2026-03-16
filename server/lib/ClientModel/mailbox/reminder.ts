import type { RuntimeBundle } from "@/lib/ClientModel/bundle/model";

const MAILBOX_IDLE_REMINDER_SECONDS = 10;
const MAILBOX_OVERFLOW_REMINDER_SECONDS = 60;

function createReminderPrompt(input: {
  unreadCount: number;
  unrepliedCount: number;
  addedCount: number;
}): string {
  return [
    "<Mailbox-reminder>",
    `<unread>${input.unreadCount}</unread>`,
    `<unreplied>${input.unrepliedCount}</unreplied>`,
    `<newlyAdded>${input.addedCount}</newlyAdded>`,
    "</Mailbox-reminder>",
  ].join("\n");
}

export async function processMailboxReminder(input: {
  bundle: RuntimeBundle;
  currentSessionID: string;
  currentStatus: string | null;
  sendPrompt: (payload: { runtimeID: string; sessionID: string; prompt: string }) => Promise<void>;
}): Promise<void> {
  const status = (input.currentStatus || "").trim().toLowerCase();
  if (status === "busy") return;

  const unreadRows = input.bundle.mailbox
    .filter((item) => item.has_read === false)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const unreadCount = unreadRows.length;
  const unrepliedCount = unreadRows.filter(
    (item) => item.mail_type === "NeedReplay" && item.info_type === "NeedReplay",
  ).length;
  const addedCount = Math.max(0, unreadCount - input.bundle.mailboxReminder.lastUnreadCount);

  input.bundle.mailboxReminder.lastUnreadCount = unreadCount;
  input.bundle.mailboxReminder.lastNeedReplayCount = unrepliedCount;

  if (unreadRows.length === 0) {
    input.bundle.mailboxReminder.idleReminderItemID = null;
    input.bundle.mailboxReminder.overflowReminderItemID = null;
    return;
  }

  const targetSessionID = input.currentSessionID.trim();
  if (!targetSessionID) return;

  const newest = unreadRows[0];
  const ageSeconds = Math.floor((Date.now() - newest.created_at.getTime()) / 1000);
  const prompt = createReminderPrompt({ unreadCount, unrepliedCount, addedCount });

  if (
    ageSeconds >= MAILBOX_OVERFLOW_REMINDER_SECONDS &&
    input.bundle.mailboxReminder.overflowReminderItemID !== newest.id
  ) {
    input.bundle.mailboxReminder.overflowReminderItemID = newest.id;
    input.bundle.mailboxReminder.idleReminderItemID = newest.id;
    await input.sendPrompt({
      runtimeID: input.bundle.runtimeID,
      sessionID: targetSessionID,
      prompt,
    });
    return;
  }

  if (
    ageSeconds >= MAILBOX_IDLE_REMINDER_SECONDS &&
    input.bundle.mailboxReminder.idleReminderItemID !== newest.id
  ) {
    input.bundle.mailboxReminder.idleReminderItemID = newest.id;
    await input.sendPrompt({
      runtimeID: input.bundle.runtimeID,
      sessionID: targetSessionID,
      prompt,
    });
  }
}
