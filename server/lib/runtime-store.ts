import type { RuntimeClientView } from "@/lib/runtime/view";
import { findRuntimeSessionBySessionID, listRuntimeSessions } from "@/lib/ClientModel/session/registry";
import { getRuntimePermission, listRuntimePermissions } from "@/lib/permission/registry";
import type { RuntimePermissionRecord, PermissionStatus } from "@/lib/permission/model";
import { listV2RuntimeClientsView } from "@/lib/v2/ws";

export type RuntimeClient = RuntimeClientView;
export type RuntimePermission = RuntimePermissionRecord;

export async function listRuntimeClients(): Promise<RuntimeClient[]> {
  return listV2RuntimeClientsView();
}

export async function getRuntimeClient(runtimeID: string): Promise<RuntimeClient | null> {
  const clients = await listRuntimeClients();
  const hit = clients.find((client) => client.runtimeID === runtimeID);
  return hit ?? null;
}

export async function canAccessRuntimePort(port: number): Promise<boolean> {
  const clients = await listRuntimeClients();
  return clients.some((client) => client.status === "online" && client.port === port);
}

export async function resolveRuntimeTargetByPort(port: number): Promise<{
  runtimeID: string;
  host?: string;
  protocol?: string;
  port: number;
} | null> {
  const clients = await listRuntimeClients();
  const picked = clients
    .filter((client) => client.status === "online" && client.port === port)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];

  if (!picked) return null;
  return {
    runtimeID: picked.runtimeID,
    host: picked.runtimeHost ?? undefined,
    protocol: picked.runtimeProtocol ?? undefined,
    port,
  };
}

export async function resolveRuntimeBySessionID(sessionID: string): Promise<RuntimeClient | null> {
  const hit = findRuntimeSessionBySessionID(sessionID);
  if (!hit) return null;
  return getRuntimeClient(hit.runtimeID);
}

export async function listRuntimeManagedSessions(runtimeID: string): Promise<Array<{
  sessionID: string;
  lastActiveTime: string | null;
  activeCount: number;
}>> {
  return listRuntimeSessions(runtimeID).map((row) => ({
    sessionID: row.sessionID,
    lastActiveTime: row.lastActiveTime,
    activeCount: row.activeCount,
  }));
}

export async function resolveRuntimeTargetByRuntimeID(runtimeID: string): Promise<{
  runtimeID: string;
  host?: string;
  protocol?: string;
  port: number;
} | null> {
  const clean = runtimeID.trim();
  if (!clean) return null;
  const clients = await listRuntimeClients();
  const hit = clients.find((client) => client.runtimeID === clean && client.status === "online");
  if (!hit) return null;
  return {
    runtimeID: hit.runtimeID,
    host: hit.runtimeHost ?? undefined,
    protocol: hit.runtimeProtocol ?? undefined,
    port: hit.port ?? 0,
  };
}

export async function listManagedRuntimePermissions(runtimeID: string, filters?: {
  sessionID?: string;
  status?: PermissionStatus;
}): Promise<RuntimePermission[]> {
  return listRuntimePermissions(runtimeID, filters);
}

export async function getManagedRuntimePermission(runtimeID: string, permissionID: string): Promise<RuntimePermission | null> {
  return getRuntimePermission(runtimeID, permissionID);
}
