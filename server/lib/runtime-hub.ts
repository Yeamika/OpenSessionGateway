import { ensureRuntimeBundle, getRuntimeBundle } from "@/lib/ClientModel/bundle/registry";

export type { RuntimeBundle } from "@/lib/ClientModel/bundle/model";
export type { RuntimeMailboxRow, RuntimeMailboxReminder } from "@/lib/ClientModel/mailbox/model";
export type { RuntimeTimerRow } from "@/lib/ClientModel/timer/model";

export {
  bindCallerToRuntime,
  ensureRuntimeBundle,
  getRuntimeBundle,
  isRuntimeOnlineInHub,
  removeRuntimeBundle,
  resolveRuntimeByCaller,
} from "@/lib/ClientModel/bundle/registry";

export function setRuntimeWsBridge(runtimeID: string, hostName: string): void {
  const bundle = ensureRuntimeBundle(runtimeID);
  const now = new Date().toISOString();
  bundle.wsBridge.connected = true;
  bundle.wsBridge.hostName = hostName || null;
  bundle.wsBridge.connectedAt = now;
  bundle.wsBridge.lastSeenAt = now;
}

export function touchRuntimeWsBridge(runtimeID: string): void {
  const bundle = getRuntimeBundle(runtimeID);
  if (!bundle) return;
  bundle.wsBridge.lastSeenAt = new Date().toISOString();
}
