import {
  createRuntimeInstanceWorkspaceBundle,
  hydrateRuntimeInstanceWorkspaceBundle,
  type RuntimeInstanceWorkspaceBundle,
} from "@/lib/ClientModel/instance-workspace/model";

const globalForInstanceWorkspaceRegistry = globalThis as unknown as {
  __osgInstanceWorkspaceRegistry?: Map<string, RuntimeInstanceWorkspaceBundle>;
  __osgCallerToRuntimeID?: Map<string, string>;
};

if (!globalForInstanceWorkspaceRegistry.__osgInstanceWorkspaceRegistry) {
  globalForInstanceWorkspaceRegistry.__osgInstanceWorkspaceRegistry = new Map<string, RuntimeInstanceWorkspaceBundle>();
}

if (!globalForInstanceWorkspaceRegistry.__osgCallerToRuntimeID) {
  globalForInstanceWorkspaceRegistry.__osgCallerToRuntimeID = new Map<string, string>();
}

const registry = globalForInstanceWorkspaceRegistry.__osgInstanceWorkspaceRegistry;
export const runtimeIDByCallerKey = globalForInstanceWorkspaceRegistry.__osgCallerToRuntimeID;

function keyOf(runtimeID: string, instanceWorkspaceDirectory: string) {
  return `${runtimeID.trim()}::${instanceWorkspaceDirectory.trim()}`;
}

export function ensureRuntimeInstanceWorkspaceBundle(
  runtimeID: string,
  instanceWorkspaceDirectory: string,
  title?: string | null,
): RuntimeInstanceWorkspaceBundle {
  const runtime = runtimeID.trim();
  const instanceWorkspace = instanceWorkspaceDirectory.trim();
  if (!runtime) throw new Error("runtimeID is required");
  if (!instanceWorkspace) throw new Error("instanceWorkspaceDirectory is required");
  const key = keyOf(runtime, instanceWorkspace);
  let bundle = registry.get(key);
  if (!bundle) {
    bundle = createRuntimeInstanceWorkspaceBundle(runtime, instanceWorkspace, title);
    registry.set(key, bundle);
  }
  bundle = hydrateRuntimeInstanceWorkspaceBundle(bundle);
  if (typeof title === "string" && title.trim()) {
    bundle.title = title.trim();
  }
  return bundle;
}

export function getRuntimeInstanceWorkspaceBundle(runtimeID: string, instanceWorkspaceDirectory: string): RuntimeInstanceWorkspaceBundle | null {
  const runtime = runtimeID.trim();
  const instanceWorkspace = instanceWorkspaceDirectory.trim();
  if (!runtime || !instanceWorkspace) return null;
  const hit = registry.get(keyOf(runtime, instanceWorkspace));
  return hit ? hydrateRuntimeInstanceWorkspaceBundle(hit) : null;
}

export function listRuntimeInstanceWorkspaces(runtimeID: string): RuntimeInstanceWorkspaceBundle[] {
  const runtime = runtimeID.trim();
  if (!runtime) return [];
  return [...registry.values()]
    .filter((row) => row.runtimeID === runtime)
    .map(hydrateRuntimeInstanceWorkspaceBundle);
}

export function findRuntimeInstanceWorkspaceByDirectory(runtimeID: string, directory: string): RuntimeInstanceWorkspaceBundle | null {
  const runtime = runtimeID.trim();
  const cleanDirectory = directory.trim();
  if (!runtime || !cleanDirectory) return null;
  return getRuntimeInstanceWorkspaceBundle(runtime, cleanDirectory);
}

export function clearRuntimeInstanceWorkspaces(runtimeID: string): void {
  const runtime = runtimeID.trim();
  if (!runtime) return;
  for (const [key, value] of registry.entries()) {
    if (value.runtimeID === runtime) {
      for (const callerKey of value.mcp.callerKeys) {
        runtimeIDByCallerKey.delete(callerKey);
      }
      registry.delete(key);
    }
  }
}
