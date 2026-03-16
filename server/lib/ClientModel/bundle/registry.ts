import { createRuntimeBundle, hydrateRuntimeBundle, type RuntimeBundle } from "@/lib/ClientModel/bundle/model";

const globalForBundleRegistry = globalThis as unknown as {
  __osgRuntimeBundleRegistry?: {
    bundles: Map<string, RuntimeBundle>;
    callerToRuntime: Map<string, string>;
  };
};

if (!globalForBundleRegistry.__osgRuntimeBundleRegistry) {
  globalForBundleRegistry.__osgRuntimeBundleRegistry = {
    bundles: new Map<string, RuntimeBundle>(),
    callerToRuntime: new Map<string, string>(),
  };
}

const registry = globalForBundleRegistry.__osgRuntimeBundleRegistry;

export function ensureRuntimeBundle(runtimeID: string): RuntimeBundle {
  const clean = runtimeID.trim();
  if (!clean) {
    throw new Error("runtimeID is required");
  }
  let bundle = registry.bundles.get(clean);
  if (!bundle) {
    bundle = createRuntimeBundle(clean);
    registry.bundles.set(clean, bundle);
  }
  return hydrateRuntimeBundle(bundle);
}

export function getRuntimeBundle(runtimeID: string): RuntimeBundle | null {
  const clean = runtimeID.trim();
  if (!clean) return null;
  const bundle = registry.bundles.get(clean) || null;
  if (!bundle) return null;
  return hydrateRuntimeBundle(bundle);
}

export function bindCallerToRuntime(callerKey: string, runtimeID: string): void {
  const key = callerKey.trim();
  if (!key) return;
  const bundle = ensureRuntimeBundle(runtimeID);
  bundle.mcp.callerKeys.add(key);
  registry.callerToRuntime.set(key, bundle.runtimeID);
}

export function resolveRuntimeByCaller(callerKey: string): string {
  const key = callerKey.trim();
  if (!key) return "";
  return registry.callerToRuntime.get(key) || "";
}

export function removeRuntimeBundle(runtimeID: string): void {
  const clean = runtimeID.trim();
  if (!clean) return;
  const bundle = registry.bundles.get(clean);
  if (!bundle) return;
  for (const timer of bundle.timers) {
    if (timer.timeout_ref) {
      clearTimeout(timer.timeout_ref);
      timer.timeout_ref = null;
      timer.status = "cancelled";
    }
  }
  for (const key of bundle.mcp.callerKeys) {
    registry.callerToRuntime.delete(key);
  }
  registry.bundles.delete(clean);
}

export function isRuntimeOnlineInHub(runtimeID: string): boolean {
  const bundle = getRuntimeBundle(runtimeID);
  return Boolean(bundle && bundle.wsBridge.connected);
}
