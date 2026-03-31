import type { PermissionStatus } from "@/lib/permission/model";
import {
  applyPermissionAsked,
  applyPermissionUpdated,
  createRuntimePermissionRecord,
  hydrateRuntimePermissionRecord,
  type PermissionAskedPayload,
  type PermissionUpdatedPayload,
  type RuntimePermissionRecord,
} from "@/lib/permission/model";

const globalForPermissionRegistry = globalThis as unknown as {
  __osgPermissionRegistry?: Map<string, RuntimePermissionRecord>;
};

if (!globalForPermissionRegistry.__osgPermissionRegistry) {
  globalForPermissionRegistry.__osgPermissionRegistry = new Map<string, RuntimePermissionRecord>();
}

const registry = globalForPermissionRegistry.__osgPermissionRegistry;

function keyOf(runtimeID: string, permissionID: string): string {
  return `${runtimeID.trim()}::${permissionID.trim()}`;
}

function sortPermissions(rows: RuntimePermissionRecord[]): RuntimePermissionRecord[] {
  return [...rows].sort((a, b) => {
    const pendingA = a.status === "created" || a.status === "pending" ? 1 : 0;
    const pendingB = b.status === "created" || b.status === "pending" ? 1 : 0;
    if (pendingA !== pendingB) return pendingB - pendingA;
    const updated = b.updatedAt.localeCompare(a.updatedAt);
    if (updated !== 0) return updated;
    return a.permissionID.localeCompare(b.permissionID);
  });
}

export function getRuntimePermission(runtimeID: string, permissionID: string): RuntimePermissionRecord | null {
  const runtime = runtimeID.trim();
  const permission = permissionID.trim();
  if (!runtime || !permission) return null;
  const hit = registry.get(keyOf(runtime, permission));
  return hit ? hydrateRuntimePermissionRecord(hit) : null;
}

export function listRuntimePermissions(runtimeID: string, filters?: {
  sessionID?: string;
  status?: PermissionStatus;
}): RuntimePermissionRecord[] {
  const runtime = runtimeID.trim();
  const sessionID = filters?.sessionID?.trim() || "";
  const status = filters?.status;
  if (!runtime) return [];
  return sortPermissions(
    [...registry.values()]
      .filter((row) => row.runtimeID === runtime)
      .filter((row) => (sessionID ? row.sessionID === sessionID : true))
      .filter((row) => (status ? row.status === status : true))
      .map(hydrateRuntimePermissionRecord),
  );
}

export function upsertPermissionAsked(runtimeID: string, payload: PermissionAskedPayload): RuntimePermissionRecord {
  const runtime = runtimeID.trim();
  const permissionID = payload.permissionID.trim();
  if (!runtime) throw new Error("runtimeID is required");
  if (!permissionID) throw new Error("permissionID is required");
  const key = keyOf(runtime, permissionID);
  const existing = registry.get(key);
  const record = existing
    ? applyPermissionAsked(hydrateRuntimePermissionRecord(existing), payload)
    : createRuntimePermissionRecord(runtime, payload);
  registry.set(key, record);

  if (payload.supersedesPermissionID) {
    const previous = getRuntimePermission(runtime, payload.supersedesPermissionID);
    if (previous) {
      previous.status = "superseded";
      previous.updatedAt = payload.requestedAt;
      previous.supersededByPermissionID = permissionID;
      registry.set(keyOf(runtime, previous.permissionID), hydrateRuntimePermissionRecord(previous));
    }
  }

  return record;
}

export function upsertPermissionUpdated(runtimeID: string, payload: PermissionUpdatedPayload): RuntimePermissionRecord {
  const runtime = runtimeID.trim();
  const permissionID = payload.permissionID.trim();
  if (!runtime) throw new Error("runtimeID is required");
  if (!permissionID) throw new Error("permissionID is required");
  const key = keyOf(runtime, permissionID);
  const existing = registry.get(key);
  const record = existing
    ? applyPermissionUpdated(hydrateRuntimePermissionRecord(existing), payload)
    : applyPermissionUpdated(
        createRuntimePermissionRecord(runtime, {
          permissionID,
          sessionID: payload.sessionID,
          displayID: null,
          kind: "permission",
          title: permissionID,
          description: null,
          detail: null,
          choices: [],
          defaultAction: null,
          requestedAt: payload.updatedAt,
          expiresAt: null,
          supersedesPermissionID: null,
          correlationID: payload.correlationID,
          dedupeKey: null,
        }),
        payload,
      );
  registry.set(key, record);

  if (payload.supersededByPermissionID) {
    const next = getRuntimePermission(runtime, payload.supersededByPermissionID);
    if (next) {
      next.supersedesPermissionID = permissionID;
      registry.set(keyOf(runtime, next.permissionID), hydrateRuntimePermissionRecord(next));
    }
  }

  return record;
}

export function markPermissionResolutionRequested(runtimeID: string, permissionID: string): RuntimePermissionRecord | null {
  return getRuntimePermission(runtimeID, permissionID);
}

export function clearRuntimePermissions(runtimeID: string): void {
  const runtime = runtimeID.trim();
  if (!runtime) return;
  for (const [key, value] of registry.entries()) {
    if (value.runtimeID === runtime) {
      registry.delete(key);
    }
  }
}
