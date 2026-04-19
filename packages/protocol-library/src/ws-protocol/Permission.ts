export const PERMISSION_ASKED_EVENT = "PermissionAsked";
export const PERMISSION_UPDATED_EVENT = "PermissionUpdated";
export const RESOLVE_PERMISSION_REQUEST_EVENT = "ResolvePermissionRequest";

export type PermissionStatus =
  | "created"
  | "pending"
  | "approved"
  | "denied"
  | "cancelled"
  | "expired"
  | "superseded"
  | "failed";

export type PermissionDecision = "approve" | "deny" | "cancel";

export type PermissionChoice = {
  value: PermissionDecision;
  label?: string;
};

export type PermissionAskedPayload = {
  permissionID: string;
  sessionID: string | null;
  displayID: string | null;
  kind: string;
  title: string;
  description: string | null;
  detail: unknown;
  choices: PermissionChoice[];
  defaultAction: PermissionDecision | null;
  requestedAt: string;
  expiresAt: string | null;
  supersedesPermissionID: string | null;
  correlationID: string | null;
  dedupeKey: string | null;
};

export type PermissionUpdatedPayload = {
  permissionID: string;
  sessionID: string | null;
  status: PermissionStatus;
  updatedAt: string;
  actor: string | null;
  reason: string | null;
  message: string | null;
  supersededByPermissionID: string | null;
  correlationID: string | null;
};

export type ResolvePermissionRequestPayload = {
  permissionID: string;
  sessionID: string | null;
  action: PermissionDecision;
  reason: string | null;
  actor: string | null;
  correlationID: string | null;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nullableString(value: unknown): string | null {
  const text = normalizeString(value);
  return text || null;
}

function nullableUnknown(value: unknown): unknown {
  return value === undefined ? null : value;
}

function normalizeDecision(value: unknown): PermissionDecision | null {
  return value === "approve" || value === "deny" || value === "cancel" ? value : null;
}

function normalizeStatus(value: unknown): PermissionStatus {
  switch (value) {
    case "created":
    case "approved":
    case "denied":
    case "cancelled":
    case "expired":
    case "superseded":
    case "failed":
      return value;
    default:
      return "pending";
  }
}

function normalizeChoices(value: unknown): PermissionChoice[] {
  if (!Array.isArray(value)) return [];
  const list: PermissionChoice[] = [];
  for (const item of value) {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const decision = normalizeDecision(row.value);
    if (!decision) continue;
    list.push({
      value: decision,
      label: normalizeString(row.label) || undefined,
    });
  }
  return list;
}

function normalizeTimestamp(value: unknown): string {
  return normalizeString(value) || new Date().toISOString();
}

export function createPermissionAskedPayload(input: {
  permissionID?: string;
  sessionID?: string | null;
  displayID?: string | null;
  kind?: string;
  title?: string;
  description?: string | null;
  detail?: unknown;
  choices?: PermissionChoice[];
  defaultAction?: PermissionDecision | null;
  requestedAt?: string;
  expiresAt?: string | null;
  supersedesPermissionID?: string | null;
  correlationID?: string | null;
  dedupeKey?: string | null;
}): PermissionAskedPayload {
  return {
    permissionID: normalizeString(input.permissionID),
    sessionID: nullableString(input.sessionID),
    displayID: nullableString(input.displayID),
    kind: normalizeString(input.kind),
    title: normalizeString(input.title),
    description: nullableString(input.description),
    detail: nullableUnknown(input.detail),
    choices: normalizeChoices(input.choices),
    defaultAction: normalizeDecision(input.defaultAction),
    requestedAt: normalizeTimestamp(input.requestedAt),
    expiresAt: nullableString(input.expiresAt),
    supersedesPermissionID: nullableString(input.supersedesPermissionID),
    correlationID: nullableString(input.correlationID),
    dedupeKey: nullableString(input.dedupeKey),
  };
}

export function readPermissionAskedPayload(raw: unknown): PermissionAskedPayload {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return createPermissionAskedPayload({
    permissionID: src.permissionID as string | undefined,
    sessionID: src.sessionID as string | null | undefined,
    displayID: src.displayID as string | null | undefined,
    kind: src.kind as string | undefined,
    title: src.title as string | undefined,
    description: src.description as string | null | undefined,
    detail: src.detail,
    choices: src.choices as PermissionChoice[] | undefined,
    defaultAction: src.defaultAction as PermissionDecision | null | undefined,
    requestedAt: src.requestedAt as string | undefined,
    expiresAt: src.expiresAt as string | null | undefined,
    supersedesPermissionID: src.supersedesPermissionID as string | null | undefined,
    correlationID: src.correlationID as string | null | undefined,
    dedupeKey: src.dedupeKey as string | null | undefined,
  });
}

export function createPermissionUpdatedPayload(input: {
  permissionID?: string;
  sessionID?: string | null;
  status?: PermissionStatus;
  updatedAt?: string;
  actor?: string | null;
  reason?: string | null;
  message?: string | null;
  supersededByPermissionID?: string | null;
  correlationID?: string | null;
}): PermissionUpdatedPayload {
  return {
    permissionID: normalizeString(input.permissionID),
    sessionID: nullableString(input.sessionID),
    status: normalizeStatus(input.status),
    updatedAt: normalizeTimestamp(input.updatedAt),
    actor: nullableString(input.actor),
    reason: nullableString(input.reason),
    message: nullableString(input.message),
    supersededByPermissionID: nullableString(input.supersededByPermissionID),
    correlationID: nullableString(input.correlationID),
  };
}

export function readPermissionUpdatedPayload(raw: unknown): PermissionUpdatedPayload {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return createPermissionUpdatedPayload({
    permissionID: src.permissionID as string | undefined,
    sessionID: src.sessionID as string | null | undefined,
    status: src.status as PermissionStatus,
    updatedAt: src.updatedAt as string | undefined,
    actor: src.actor as string | null | undefined,
    reason: src.reason as string | null | undefined,
    message: src.message as string | null | undefined,
    supersededByPermissionID: src.supersededByPermissionID as string | null | undefined,
    correlationID: src.correlationID as string | null | undefined,
  });
}

export function createResolvePermissionRequestPayload(input: {
  permissionID?: string;
  sessionID?: string | null;
  action?: PermissionDecision;
  reason?: string | null;
  actor?: string | null;
  correlationID?: string | null;
}): ResolvePermissionRequestPayload {
  return {
    permissionID: normalizeString(input.permissionID),
    sessionID: nullableString(input.sessionID),
    action: normalizeDecision(input.action) || "cancel",
    reason: nullableString(input.reason),
    actor: nullableString(input.actor),
    correlationID: nullableString(input.correlationID),
  };
}

export function readResolvePermissionRequestPayload(raw: unknown): ResolvePermissionRequestPayload {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return createResolvePermissionRequestPayload({
    permissionID: src.permissionID as string | undefined,
    sessionID: src.sessionID as string | null | undefined,
    action: src.action as PermissionDecision,
    reason: src.reason as string | null | undefined,
    actor: src.actor as string | null | undefined,
    correlationID: src.correlationID as string | null | undefined,
  });
}
