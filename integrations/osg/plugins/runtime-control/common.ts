export function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeList(value: unknown, fallback = 10): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

export function normalizeRegex(value: unknown): RegExp | null {
  const source = normalizeString(value);
  if (!source) return null;
  try {
    return new RegExp(source, "i");
  } catch {
    throw new Error("regex is invalid");
  }
}

export function normalizePermissionStatus(value: unknown):
  | "created"
  | "pending"
  | "approved"
  | "denied"
  | "cancelled"
  | "expired"
  | "superseded"
  | "failed"
  | "" {
  switch (normalizeString(value)) {
    case "created":
    case "pending":
    case "approved":
    case "denied":
    case "cancelled":
    case "expired":
    case "superseded":
    case "failed":
      return normalizeString(value) as
        | "created"
        | "pending"
        | "approved"
        | "denied"
        | "cancelled"
        | "expired"
        | "superseded"
        | "failed";
    default:
      return "";
  }
}

export function normalizePermissionDecision(value: unknown): "approve" | "deny" | "cancel" {
  const clean = normalizeString(value);
  if (clean === "approve" || clean === "deny") return clean;
  return "cancel";
}

export function normalizeQuestionStatus(value: unknown):
  | "created"
  | "pending"
  | "answered"
  | "rejected"
  | "failed"
  | "" {
  switch (normalizeString(value)) {
    case "created":
    case "pending":
    case "answered":
    case "rejected":
    case "failed":
      return normalizeString(value) as "created" | "pending" | "answered" | "rejected" | "failed";
    default:
      return "";
  }
}

export function normalizeQuestionReplyType(value: unknown): "answer" | "reject" {
  return normalizeString(value) === "reject" ? "reject" : "answer";
}

export function readLastActiveTime(value: { lastActiveTime?: string | null } | null | undefined): string {
  return typeof value?.lastActiveTime === "string" ? value.lastActiveTime : "";
}

export function readActiveCount(value: { activeCount?: number } | null | undefined): number {
  const count = Number(value?.activeCount);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

export function textResult(data: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}
