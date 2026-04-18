import { getRuntimeSessionBundle } from "@/lib/runtime-hub";
import { listRuntimeClients } from "@/lib/runtime-store";
import { requestRuntime } from "@/lib/v2/ws";

export async function hasOnlineRuntime(runtimeID: string): Promise<boolean> {
  const clean = runtimeID.trim();
  if (!clean) return false;
  const clients = await listRuntimeClients();
  return clients.some((item) => item.status === "online" && item.runtimeID === clean);
}

export async function hasOnlineRuntimeSession(runtimeID: string, sessionID: string): Promise<boolean> {
  const runtime = runtimeID.trim();
  const session = sessionID.trim();
  if (!runtime || !session) return false;
  const clients = await listRuntimeClients();
  const runtimeOnline = clients.some((item) => item.status === "online" && item.runtimeID === runtime);
  if (!runtimeOnline) return false;
  if (getRuntimeSessionBundle(runtime, session)) return true;
  try {
    const probed = await requestRuntime(runtime, { sessionID: session });
    return probed?.session?.exists === true;
  } catch {
    return false;
  }
}

export async function requireOnlineRuntime(runtimeID: string): Promise<void> {
  const ok = await hasOnlineRuntime(runtimeID);
  if (!ok) {
    throw new Error("runtimeID is not connected via ws");
  }
}

export async function requireOnlineRuntimeSession(runtimeID: string, sessionID: string): Promise<void> {
  const ok = await hasOnlineRuntimeSession(runtimeID, sessionID);
  if (!ok) {
    throw new Error("RuntimeID and SessionID must match one online session");
  }
}
