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

export type RuntimePermissionRecord = {
  permissionID: string;
  runtimeID: string;
  sessionID: string | null;
  displayID: string | null;
  kind: string;
  title: string;
  description: string | null;
  detail: unknown;
  choices: PermissionAskedPayload["choices"];
  defaultAction: PermissionDecision | null;
  status: PermissionStatus;
  requestedAt: string;
  updatedAt: string;
  expiresAt: string | null;
  resolvedAt: string | null;
  actor: string | null;
  reason: string | null;
  message: string | null;
  correlationID: string | null;
  dedupeKey: string | null;
  supersedesPermissionID: string | null;
  supersededByPermissionID: string | null;
};

export function createRuntimePermissionRecord(runtimeID: string, payload: PermissionAskedPayload): RuntimePermissionRecord {
  const now = payload.requestedAt || new Date().toISOString();
  return {
    permissionID: payload.permissionID.trim(),
    runtimeID: runtimeID.trim(),
    sessionID: payload.sessionID,
    displayID: payload.displayID,
    kind: payload.kind,
    title: payload.title,
    description: payload.description,
    detail: payload.detail,
    choices: payload.choices,
    defaultAction: payload.defaultAction,
    status: "created",
    requestedAt: now,
    updatedAt: now,
    expiresAt: payload.expiresAt,
    resolvedAt: null,
    actor: null,
    reason: null,
    message: null,
    correlationID: payload.correlationID,
    dedupeKey: payload.dedupeKey,
    supersedesPermissionID: payload.supersedesPermissionID,
    supersededByPermissionID: null,
  };
}

export function hydrateRuntimePermissionRecord(record: RuntimePermissionRecord): RuntimePermissionRecord {
  record.permissionID = record.permissionID.trim();
  record.runtimeID = record.runtimeID.trim();
  record.sessionID = typeof record.sessionID === "string" && record.sessionID.trim() ? record.sessionID.trim() : null;
  record.displayID = typeof record.displayID === "string" && record.displayID.trim() ? record.displayID.trim() : null;
  record.kind = record.kind.trim();
  record.title = record.title.trim();
  record.description = typeof record.description === "string" && record.description.trim() ? record.description.trim() : null;
  record.expiresAt = typeof record.expiresAt === "string" && record.expiresAt.trim() ? record.expiresAt.trim() : null;
  record.resolvedAt = typeof record.resolvedAt === "string" && record.resolvedAt.trim() ? record.resolvedAt.trim() : null;
  record.actor = typeof record.actor === "string" && record.actor.trim() ? record.actor.trim() : null;
  record.reason = typeof record.reason === "string" && record.reason.trim() ? record.reason.trim() : null;
  record.message = typeof record.message === "string" && record.message.trim() ? record.message.trim() : null;
  record.correlationID = typeof record.correlationID === "string" && record.correlationID.trim() ? record.correlationID.trim() : null;
  record.dedupeKey = typeof record.dedupeKey === "string" && record.dedupeKey.trim() ? record.dedupeKey.trim() : null;
  record.supersedesPermissionID =
    typeof record.supersedesPermissionID === "string" && record.supersedesPermissionID.trim() ? record.supersedesPermissionID.trim() : null;
  record.supersededByPermissionID =
    typeof record.supersededByPermissionID === "string" && record.supersededByPermissionID.trim() ? record.supersededByPermissionID.trim() : null;
  record.choices = Array.isArray(record.choices) ? record.choices : [];
  return record;
}

export function applyPermissionAsked(record: RuntimePermissionRecord, payload: PermissionAskedPayload): RuntimePermissionRecord {
  record.sessionID = payload.sessionID;
  record.displayID = payload.displayID;
  record.kind = payload.kind;
  record.title = payload.title;
  record.description = payload.description;
  record.detail = payload.detail;
  record.choices = payload.choices;
  record.defaultAction = payload.defaultAction;
  record.requestedAt = payload.requestedAt;
  record.updatedAt = payload.requestedAt;
  record.expiresAt = payload.expiresAt;
  record.correlationID = payload.correlationID;
  record.dedupeKey = payload.dedupeKey;
  record.supersedesPermissionID = payload.supersedesPermissionID;
  return hydrateRuntimePermissionRecord(record);
}

export function applyPermissionUpdated(record: RuntimePermissionRecord, payload: PermissionUpdatedPayload): RuntimePermissionRecord {
  if (payload.sessionID) {
    record.sessionID = payload.sessionID;
  }
  record.status = payload.status;
  record.updatedAt = payload.updatedAt;
  record.actor = payload.actor;
  record.reason = payload.reason;
  record.message = payload.message;
  record.correlationID = payload.correlationID || record.correlationID;
  record.supersededByPermissionID = payload.supersededByPermissionID;
  if (payload.status === "approved" || payload.status === "denied" || payload.status === "cancelled") {
    record.resolvedAt = payload.updatedAt;
  }
  return hydrateRuntimePermissionRecord(record);
}
