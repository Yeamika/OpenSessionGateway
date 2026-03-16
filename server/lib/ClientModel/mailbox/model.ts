import { normalizeNonNegativeInteger, normalizeOptionalString } from "@/lib/ClientModel/shared/normalize";

export type RuntimeMailboxRow = {
  id: string;
  recipient_runtime_id: string;
  recipient_session_id: string | null;
  sender_runtime_id: string;
  sender_session_id: string;
  sender_session_title: string;
  mail_type: string;
  info_type: string;
  title: string;
  content: string;
  replay_id: string | null;
  has_read: boolean;
  created_at: Date;
};

export type RuntimeMailboxReminder = {
  idleReminderItemID: string | null;
  overflowReminderItemID: string | null;
  lastUnreadCount: number;
  lastNeedReplayCount: number;
};

export function createRuntimeMailboxReminder(): RuntimeMailboxReminder {
  return {
    idleReminderItemID: null,
    overflowReminderItemID: null,
    lastUnreadCount: 0,
    lastNeedReplayCount: 0,
  };
}

export function hydrateRuntimeMailboxReminder(value: unknown): RuntimeMailboxReminder {
  if (!value || typeof value !== "object") {
    return createRuntimeMailboxReminder();
  }
  const row = value as Partial<RuntimeMailboxReminder>;
  return {
    idleReminderItemID: normalizeOptionalString(row.idleReminderItemID),
    overflowReminderItemID: normalizeOptionalString(row.overflowReminderItemID),
    lastUnreadCount: normalizeNonNegativeInteger(row.lastUnreadCount),
    lastNeedReplayCount: normalizeNonNegativeInteger(row.lastNeedReplayCount),
  };
}
