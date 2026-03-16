import type { RuntimeClientView } from "@/lib/runtime-node";
import { listV2RuntimeClientsView } from "@/lib/v2/ws";

export type RuntimeClient = RuntimeClientView;

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
  const clean = sessionID.trim();
  if (!clean) return null;
  const clients = await listRuntimeClients();
  return (
    clients
      .filter((client) => client.status === "online" && client.sessionID === clean)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0] ?? null
  );
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
