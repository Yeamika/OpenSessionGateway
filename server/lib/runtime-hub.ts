import { ensureRuntimeBundle, getRuntimeBundle } from "@/lib/ClientModel/registry";

export type { RuntimeBundle } from "@/lib/ClientModel/model";

export {
  ensureRuntimeBundle,
  getRuntimeBundle,
  isRuntimeOnlineInHub,
  listRuntimeBundles,
  markRuntimeBundleDisconnected,
  removeRuntimeBundle,
} from "@/lib/ClientModel/registry";

export { ensureRuntimeSessionBundle, getRuntimeSessionBundle } from "@/lib/ClientModel/session/registry";

export {
  ensureRuntimeInstanceWorkspaceBundle,
  getRuntimeInstanceWorkspaceBundle,
} from "@/lib/ClientModel/instance-workspace/registry";

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
