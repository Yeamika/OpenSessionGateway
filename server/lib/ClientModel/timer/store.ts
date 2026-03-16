import { randomUUID } from "node:crypto";

import type { RuntimeTimerRow } from "@/lib/ClientModel/timer/model";
import { getRuntimeBundle } from "@/lib/runtime-hub";
import { requestAddPromot, sendServerToast } from "@/lib/v2/ws";

type TimerView = {
  TimerID: string;
  RuntimeID: string;
  SessionID: string;
  Title: string;
  MSG: string;
  DelaySeconds: number;
  createdAt: string;
  triggerAt: string;
  triggeredAt: string | null;
  status: "pending" | "triggered" | "cancelled";
};

function toTimerView(row: RuntimeTimerRow): TimerView {
  return {
    TimerID: row.id,
    RuntimeID: row.runtime_id,
    SessionID: row.session_id,
    Title: row.title,
    MSG: row.message,
    DelaySeconds: Math.floor(row.delay_ms / 1000),
    createdAt: row.created_at.toISOString(),
    triggerAt: row.trigger_at.toISOString(),
    triggeredAt: row.triggered_at ? row.triggered_at.toISOString() : null,
    status: row.status,
  };
}

async function fireTimer(runtimeID: string, timerID: string) {
  const bundle = getRuntimeBundle(runtimeID);
  if (!bundle) return;

  const rowIndex = bundle.timers.findIndex((item) => item.id === timerID && item.status === "pending");
  if (rowIndex < 0) return;
  const row = bundle.timers[rowIndex];
  if (!row) return;

  row.status = "triggered";
  row.triggered_at = new Date();
  row.timeout_ref = null;

  const wrappedPrompt = [
    "<timer>",
    `<TimerID>${row.id}</TimerID>`,
    `<Title>${row.title}</Title>`,
    "</timer>",
    "<content>",
    row.message,
    "</content>",
  ].join("\n");

  try {
    await requestAddPromot(runtimeID, row.session_id, wrappedPrompt, undefined, "system");
  } catch {
  }

  try {
    await sendServerToast(runtimeID, {
      title: row.title,
      message: row.message,
      subtitle: "Timer",
      variant: "info",
      durationMs: 5000,
    });
  } catch {
  }

  bundle.timers.splice(rowIndex, 1);
}

export async function addOneShotTimer(input: {
  runtimeID: string;
  sessionID: string;
  title: string;
  msg: string;
  delaySeconds: number;
}) {
  const bundle = getRuntimeBundle(input.runtimeID);
  if (!bundle) {
    throw new Error("runtime not found");
  }

  const timerID = randomUUID();
  const now = new Date();
  const delayMs = input.delaySeconds * 1000;
  const triggerAt = new Date(now.getTime() + delayMs);

  const row: RuntimeTimerRow = {
    id: timerID,
    runtime_id: input.runtimeID,
    session_id: input.sessionID,
    title: input.title,
    message: input.msg,
    delay_ms: delayMs,
    created_at: now,
    trigger_at: triggerAt,
    triggered_at: null,
    status: "pending",
    timeout_ref: null,
  };

  row.timeout_ref = setTimeout(() => {
    void fireTimer(input.runtimeID, timerID);
  }, delayMs);

  bundle.timers.push(row);
  return toTimerView(row);
}

export async function listRuntimeTimers(input: {
  runtimeID: string;
  sessionID: string;
}) {
  const bundle = getRuntimeBundle(input.runtimeID);
  const rows = (bundle?.timers || [])
    .filter((item) => item.runtime_id === input.runtimeID && item.session_id === input.sessionID)
    .sort((a, b) => (a.trigger_at > b.trigger_at ? 1 : -1));

  return {
    realsize: rows.length,
    list: rows.map(toTimerView),
  };
}
