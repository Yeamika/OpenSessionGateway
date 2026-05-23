export type TimerType = "one_shot" | "periodic" | "cron";
export type TimerStatus = "pending" | "waiting_runtime";

export type TimerRow = {
  TimerID: string;
  RuntimeID: string;
  SessionID: string;
  Title: string;
  MSG: string;
  TimerType: TimerType;
  DelaySeconds: number;
  EverySeconds?: number;
  CronExpr?: string;
  createdAt: string;
  triggerAt: string;
  status: TimerStatus;
  lastError?: string;
};

export function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function positiveInt(value: unknown, name: string): number {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) throw new Error(`${name} must be a positive integer`);
  return num;
}

export function normalizeTimerType(value: unknown): TimerType {
  return value === "periodic" || value === "cron" ? value : "one_shot";
}

export function view(row: TimerRow) {
  return {
    TimerID: row.TimerID,
    RuntimeID: row.RuntimeID,
    SessionID: row.SessionID,
    Title: row.Title,
    MSG: row.MSG,
    TimerType: row.TimerType,
    DelaySeconds: row.DelaySeconds,
    EverySeconds: row.EverySeconds,
    CronExpr: row.CronExpr,
    createdAt: row.createdAt,
    triggerAt: row.triggerAt,
    status: row.status,
    lastError: row.lastError,
  };
}

export function wrapTimer(row: TimerRow): string {
  const meta = [
    "<timer>",
    `<TimerID>${row.TimerID}</TimerID>`,
    `<TimerType>${row.TimerType}</TimerType>`,
    `<Title>${row.Title}</Title>`,
    `<TriggerAt>${row.triggerAt}</TriggerAt>`,
    ...(row.DelaySeconds > 0 ? [`<DelaySeconds>${row.DelaySeconds}</DelaySeconds>`] : []),
    ...(typeof row.EverySeconds === "number" ? [`<EverySeconds>${row.EverySeconds}</EverySeconds>`] : []),
    ...(row.CronExpr ? [`<CronExpr>${row.CronExpr}</CronExpr>`] : []),
    "</timer>",
    "<content>",
    row.MSG,
    "</content>",
  ];
  return meta.join("\n");
}

export function parseRpc(body: unknown): {
  id: unknown;
  method: string;
  params: Record<string, unknown>;
} {
  const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  return {
    id: payload.id ?? null,
    method: typeof payload.method === "string" ? payload.method.trim() : "",
    params: payload.params && typeof payload.params === "object"
      ? (payload.params as Record<string, unknown>)
      : {},
  };
}

export function successResult(id: unknown, result: unknown) {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

export function errorResult(id: unknown, code: number, message: string) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  };
}

export function textResult(data: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}
