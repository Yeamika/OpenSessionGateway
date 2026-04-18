import {
  createRuntimeDisplayBundle,
  hydrateRuntimeDisplayBundle,
  type RuntimeDisplayBundle,
} from "@/lib/ClientModel/display/model";

const globalForDisplayRegistry = globalThis as unknown as {
  __osgDisplayRegistry?: Map<string, RuntimeDisplayBundle>;
};

if (!globalForDisplayRegistry.__osgDisplayRegistry) {
  globalForDisplayRegistry.__osgDisplayRegistry = new Map<string, RuntimeDisplayBundle>();
}

const registry = globalForDisplayRegistry.__osgDisplayRegistry;

function keyOf(runtimeID: string, displayID: string) {
  return `${runtimeID.trim()}::${displayID.trim()}`;
}

export function ensureRuntimeDisplayBundle(runtimeID: string, displayID: string): RuntimeDisplayBundle {
  const runtime = runtimeID.trim();
  const display = displayID.trim();
  if (!runtime) throw new Error("runtimeID is required");
  if (!display) throw new Error("displayID is required");
  const key = keyOf(runtime, display);
  let bundle = registry.get(key);
  if (!bundle) {
    bundle = createRuntimeDisplayBundle(runtime, display);
    registry.set(key, bundle);
  }
  return hydrateRuntimeDisplayBundle(bundle);
}

export function listRuntimeDisplays(runtimeID: string): RuntimeDisplayBundle[] {
  const runtime = runtimeID.trim();
  if (!runtime) return [];
  return [...registry.values()]
    .filter((row) => row.runtimeID === runtime)
    .map(hydrateRuntimeDisplayBundle);
}

export function clearRuntimeDisplays(runtimeID: string): void {
  const runtime = runtimeID.trim();
  if (!runtime) return;
  for (const [key, value] of registry.entries()) {
    if (value.runtimeID === runtime) {
      registry.delete(key);
    }
  }
}
