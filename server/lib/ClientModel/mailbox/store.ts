import { randomUUID } from "node:crypto";

import type { RuntimeMailboxRow } from "@/lib/ClientModel/mailbox/model";
import { getRuntimeBundle } from "@/lib/runtime-hub";
import { sendServerToast } from "@/lib/v2/ws";

type MailRow = RuntimeMailboxRow;

function toInfoType(row: MailRow): string {
  if (row.info_type === "QuestReply" && row.replay_id) {
    return `QuestReply(${row.replay_id})`;
  }
  return row.info_type;
}

export async function sendMailboxItem(input: {
  recipientRuntimeID: string;
  recipientSessionID: string;
  senderRuntimeID: string;
  senderSessionID: string;
  senderSessionTitle: string;
  title: string;
  message: string;
  mailType: "Notice" | "NeedReplay";
}) {
  const id = randomUUID();
  const replayID = input.mailType === "NeedReplay" ? randomUUID() : null;
  const recipient = getRuntimeBundle(input.recipientRuntimeID);
  if (!recipient) {
    throw new Error("recipient runtime not found");
  }
  recipient.mailbox.push({
    id,
    recipient_runtime_id: input.recipientRuntimeID,
    recipient_session_id: input.recipientSessionID || null,
    sender_runtime_id: input.senderRuntimeID,
    sender_session_id: input.senderSessionID,
    sender_session_title: input.senderSessionTitle,
    mail_type: input.mailType,
    info_type: input.mailType,
    title: input.title,
    content: input.message,
    replay_id: replayID,
    has_read: false,
    created_at: new Date(),
  });

  void sendServerToast(input.recipientRuntimeID, {
    title: "New Mail Received",
    message: `title=${input.title}`,
    subtitle: "Mailbox",
    variant: "info",
    durationMs: 5000,
  }).catch(() => {});
  return id;
}

export async function listMailboxItems(input: {
  runtimeID: string;
  size: number;
  regex?: string;
  metadataRegex?: string;
}) {
  const regex = typeof input.regex === "string" && input.regex.trim() ? new RegExp(input.regex) : null;
  const metadataRegex =
    typeof input.metadataRegex === "string" && input.metadataRegex.trim() ? new RegExp(input.metadataRegex) : null;

  const recipient = getRuntimeBundle(input.runtimeID);
  const rows = (recipient?.mailbox || [])
    .filter((row) => row.recipient_runtime_id === input.runtimeID)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  const filtered = rows.filter((row) => {
    if (regex && !regex.test(`${row.title}\n${row.content}`)) return false;
    if (!metadataRegex) return true;
    const metaText = [
      row.created_at.toISOString(),
      toInfoType(row),
      String(row.has_read),
      row.sender_session_id,
      row.sender_session_title,
    ].join("\n");
    return metadataRegex.test(metaText);
  });

  return {
    realsize: filtered.length,
    list: filtered.slice(0, input.size).map((row) => ({
      ItemID: row.id,
      ReplayID: row.replay_id,
      senderSessionID: row.sender_session_id,
      senderSessionTitle: row.sender_session_title,
      InfoType: toInfoType(row),
      hasRead: row.has_read,
      title: row.title,
      times: row.created_at.toISOString(),
    })),
  };
}

export async function markMailboxRead(input: {
  runtimeID: string;
  itemID: string;
}) {
  const recipient = getRuntimeBundle(input.runtimeID);
  const row = recipient?.mailbox.find((item) => item.id === input.itemID && item.recipient_runtime_id === input.runtimeID);
  if (!row) return null;
  row.has_read = true;
  return {
    ItemID: row.id,
    ReplayID: row.replay_id,
    senderRuntimeID: row.sender_runtime_id,
    senderSessionID: row.sender_session_id,
    senderSessionTitle: row.sender_session_title,
    InfoType: toInfoType(row),
    hasRead: row.has_read,
    title: row.title,
    content: row.content,
    times: row.created_at.toISOString(),
  };
}

export async function replayMailboxItem(input: {
  runtimeID: string;
  replayID: string;
  message: string;
  senderSessionID: string;
  senderSessionTitle: string;
}) {
  const current = getRuntimeBundle(input.runtimeID);
  const original = current?.mailbox.find(
    (item) =>
      item.recipient_runtime_id === input.runtimeID &&
      item.mail_type === "NeedReplay" &&
      item.info_type === "NeedReplay" &&
      item.replay_id === input.replayID,
  );
  if (!original) {
    return { ok: false, message: "ReplayID not found" };
  }

  const id = randomUUID();
  const target = getRuntimeBundle(original.sender_runtime_id);
  if (!target) {
    return { ok: false, message: "target runtime not found" };
  }
  target.mailbox.push({
    id,
    recipient_runtime_id: original.sender_runtime_id,
    recipient_session_id: original.sender_session_id || null,
    sender_runtime_id: input.runtimeID,
    sender_session_id: input.senderSessionID,
    sender_session_title: input.senderSessionTitle,
    mail_type: "Notice",
    info_type: "QuestReply",
    title: `Reply: ${original.title}`,
    content: input.message,
    replay_id: original.replay_id,
    has_read: false,
    created_at: new Date(),
  });

  void sendServerToast(original.sender_runtime_id, {
    title: "New Mail Received",
    message: `title=Reply: ${original.title}`,
    subtitle: "Mailbox",
    variant: "info",
    durationMs: 5000,
  }).catch(() => {});

  original.info_type = "Replaied";
  return { ok: true, replayMailID: id };
}
