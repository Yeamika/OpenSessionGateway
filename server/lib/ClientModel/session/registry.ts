import {
  createRuntimeSessionBundle,
  hydrateRuntimeSessionBundle,
  type RuntimeSessionBundle,
} from "@/lib/ClientModel/session/model";

const globalForSessionRegistry = globalThis as unknown as {
  __osgSessionRegistry?: Map<string, RuntimeSessionBundle>;
};

if (!globalForSessionRegistry.__osgSessionRegistry) {
  globalForSessionRegistry.__osgSessionRegistry = new Map<string, RuntimeSessionBundle>();
}

const registry = globalForSessionRegistry.__osgSessionRegistry;

function keyOf(runtimeID: string, sessionID: string) {
  return `${runtimeID.trim()}::${sessionID.trim()}`;
}

function sortSessions(rows: RuntimeSessionBundle[]): RuntimeSessionBundle[] {
  return [...rows].sort((a, b) => {
    if (a.activeCount !== b.activeCount) {
      return b.activeCount - a.activeCount;
    }
    const activeTime = (b.lastActiveTime || "").localeCompare(a.lastActiveTime || "");
    if (activeTime !== 0) return activeTime;
    const status = (b.state || "").localeCompare(a.state || "");
    if (status !== 0) return status;
    const title = (a.title || "").localeCompare(b.title || "");
    if (title !== 0) return title;
    return a.sessionID.localeCompare(b.sessionID);
  });
}

export function ensureRuntimeSessionBundle(
  runtimeID: string,
  sessionID: string,
): RuntimeSessionBundle {
  const runtime = runtimeID.trim();
  const session = sessionID.trim();
  if (!runtime) throw new Error("runtimeID is required");
  if (!session) throw new Error("sessionID is required");
  const key = keyOf(runtime, session);
  let bundle = registry.get(key);
  if (!bundle) {
    bundle = createRuntimeSessionBundle(runtime, session);
    registry.set(key, bundle);
  }
  bundle = hydrateRuntimeSessionBundle(bundle);
  return bundle;
}

export function getRuntimeSessionBundle(runtimeID: string, sessionID: string): RuntimeSessionBundle | null {
  const runtime = runtimeID.trim();
  const session = sessionID.trim();
  if (!runtime || !session) return null;
  const hit = registry.get(keyOf(runtime, session));
  return hit ? hydrateRuntimeSessionBundle(hit) : null;
}

export function listRuntimeSessions(runtimeID: string): RuntimeSessionBundle[] {
  const runtime = runtimeID.trim();
  if (!runtime) return [];
  return sortSessions([...registry.values()]
    .filter((row) => row.runtimeID === runtime)
    .map(hydrateRuntimeSessionBundle));
}

export function findRuntimeSessionBySessionID(sessionID: string): RuntimeSessionBundle | null {
  const clean = sessionID.trim();
  if (!clean) return null;
  return [...registry.values()]
    .filter((row) => row.sessionID === clean)
    .map(hydrateRuntimeSessionBundle)[0] || null;
}

export function clearRuntimeSessions(runtimeID: string): void {
  const runtime = runtimeID.trim();
  if (!runtime) return;
  for (const [key, value] of registry.entries()) {
    if (value.runtimeID === runtime) {
      registry.delete(key);
    }
  }
}
