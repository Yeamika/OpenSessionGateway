import { clearRuntimeDisplays } from "@/lib/ClientModel/display/registry";
import { createRuntimeBundle, hydrateRuntimeBundle, type RuntimeBundle } from "@/lib/ClientModel/model";
import {
  clearRuntimeSessions,
} from "@/lib/ClientModel/session/registry";
import {
  clearRuntimeInstanceWorkspaces,
} from "@/lib/ClientModel/instance-workspace/registry";

const globalForRuntimeRegistry = globalThis as unknown as {
  __osgRuntimeRegistry?: Map<string, RuntimeBundle>;
};

if (!globalForRuntimeRegistry.__osgRuntimeRegistry) {
  globalForRuntimeRegistry.__osgRuntimeRegistry = new Map<string, RuntimeBundle>();
}

const registry = globalForRuntimeRegistry.__osgRuntimeRegistry;

export function listRuntimeBundles(): RuntimeBundle[] {
  return [...registry.values()].map(hydrateRuntimeBundle);
}

export function ensureRuntimeBundle(runtimeID: string): RuntimeBundle {
  const clean = runtimeID.trim();
  if (!clean) throw new Error("runtimeID is required");
  let bundle = registry.get(clean);
  if (!bundle) {
    bundle = createRuntimeBundle(clean);
    registry.set(clean, bundle);
  }
  return hydrateRuntimeBundle(bundle);
}

export function getRuntimeBundle(runtimeID: string): RuntimeBundle | null {
  const clean = runtimeID.trim();
  if (!clean) return null;
  const bundle = registry.get(clean);
  return bundle ? hydrateRuntimeBundle(bundle) : null;
}

export function markRuntimeBundleDisconnected(runtimeID: string, lastSeenAt?: string): void {
  const bundle = getRuntimeBundle(runtimeID);
  if (!bundle) return;
  bundle.wsBridge.connected = false;
  if (typeof lastSeenAt === "string" && lastSeenAt.trim()) {
    bundle.wsBridge.lastSeenAt = lastSeenAt.trim();
  }
}

export function removeRuntimeBundle(runtimeID: string): void {
  const clean = runtimeID.trim();
  if (!clean) return;
  clearRuntimeSessions(clean);
  clearRuntimeInstanceWorkspaces(clean);
  clearRuntimeDisplays(clean);
  registry.delete(clean);
}

export function isRuntimeOnlineInHub(runtimeID: string): boolean {
  const bundle = getRuntimeBundle(runtimeID);
  return Boolean(bundle && bundle.wsBridge.connected);
}
