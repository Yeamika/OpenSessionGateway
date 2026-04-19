export type MonitorRuntimeStatus = "online" | "offline";
export type MonitorSessionState = "idle" | "busy" | "waiting" | "stopped" | null;
export type MonitorSessionReason = "completed" | "pending" | "tool" | "generating" | "reasoning" | "compacting" | "permission" | "question" | "aborted" | "error" | null;

export type MonitorClient = {
  key: string;
  runtimeID: string;
  sessionID: string | null;
  displayID: string | null;
  runtimeHost: string | null;
  instanceWorkspaceDirectory: string | null;
  title: string | null;
  status: MonitorRuntimeStatus;
  sessionState: MonitorSessionState;
  sessionReason: MonitorSessionReason;
  sessionMeta: Record<string, unknown> | null;
  lastActiveTime: string | null;
  activeCount: number;
};

export type MonitorSnapshotPayload = {
  type: "snapshot";
  timestamp: string;
  data: MonitorClient[];
};

export type MonitorPatchPayload = {
  type: "patch";
  timestamp: string;
  upsert: MonitorClient[];
  remove: string[];
};

export type MonitorStreamPayload = MonitorSnapshotPayload | MonitorPatchPayload;

type MonitorClientSource = {
  runtimeID: string;
  sessionID: string | null;
  displayID: string | null;
  runtimeHost: string | null;
  instanceWorkspaceDirectory: string | null;
  title: string | null;
  status: MonitorRuntimeStatus;
  sessionState: MonitorSessionState;
  sessionReason: MonitorSessionReason;
  sessionMeta: Record<string, unknown> | null;
  lastActiveTime: string | null;
  activeCount: number;
};

const RUNTIME_STATUSES: MonitorRuntimeStatus[] = ["online", "offline"];
const SESSION_STATES: Array<Exclude<MonitorSessionState, null>> = ["idle", "busy", "waiting", "stopped"];
const SESSION_REASONS: Array<Exclude<MonitorSessionReason, null>> = ["completed", "pending", "tool", "generating", "reasoning", "compacting", "permission", "question", "aborted", "error"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isMonitorRuntimeStatus(value: unknown): value is MonitorRuntimeStatus {
  return typeof value === "string" && RUNTIME_STATUSES.includes(value as MonitorRuntimeStatus);
}

function isMonitorSessionState(value: unknown): value is MonitorSessionState {
  return value === null || (typeof value === "string" && SESSION_STATES.includes(value as Exclude<MonitorSessionState, null>));
}

function isMonitorSessionReason(value: unknown): value is MonitorSessionReason {
  return value === null || (typeof value === "string" && SESSION_REASONS.includes(value as Exclude<MonitorSessionReason, null>));
}

export function createMonitorClientKey(source: {
  runtimeID: string;
  sessionID: string | null;
  displayID: string | null;
  instanceWorkspaceDirectory: string | null;
}): string {
  return [
    source.runtimeID.trim(),
    source.sessionID?.trim() || "-",
    source.displayID?.trim() || "-",
    source.instanceWorkspaceDirectory?.trim() || "-",
  ].join("::");
}

export function toMonitorClient(source: MonitorClientSource): MonitorClient {
  return {
    key: createMonitorClientKey(source),
    runtimeID: source.runtimeID,
    sessionID: source.sessionID,
    displayID: source.displayID,
    runtimeHost: source.runtimeHost,
    instanceWorkspaceDirectory: source.instanceWorkspaceDirectory,
    title: source.title,
    status: source.status,
    sessionState: source.sessionState,
    sessionReason: source.sessionReason,
    sessionMeta: source.sessionMeta,
    lastActiveTime: source.lastActiveTime,
    activeCount: source.activeCount,
  };
}

function runtimeStatusRank(status: MonitorRuntimeStatus): number {
  if (status === "online") return 1;
  return 0;
}

export function sortMonitorClients(data: MonitorClient[]): MonitorClient[] {
  return [...data].sort((a, b) => {
    const status = runtimeStatusRank(b.status) - runtimeStatusRank(a.status);
    if (status !== 0) return status;
    if (a.activeCount !== b.activeCount) return b.activeCount - a.activeCount;
    const lastActive = (b.lastActiveTime || "").localeCompare(a.lastActiveTime || "");
    if (lastActive !== 0) return lastActive;
    const runtime = a.runtimeID.localeCompare(b.runtimeID);
    if (runtime !== 0) return runtime;
    const instanceWorkspace = (a.instanceWorkspaceDirectory || "").localeCompare(b.instanceWorkspaceDirectory || "");
    if (instanceWorkspace !== 0) return instanceWorkspace;
    const display = (a.displayID || "").localeCompare(b.displayID || "");
    if (display !== 0) return display;
    const title = (a.title || "").localeCompare(b.title || "");
    if (title !== 0) return title;
    const session = (a.sessionID || "").localeCompare(b.sessionID || "");
    if (session !== 0) return session;
    return a.key.localeCompare(b.key);
  });
}

export function createMonitorSnapshotPayload(data: MonitorClient[], timestamp = new Date().toISOString()): MonitorSnapshotPayload {
  return {
    type: "snapshot",
    timestamp,
    data: sortMonitorClients(data),
  };
}

export function createMonitorPatchPayload(
  upsert: MonitorClient[],
  remove: string[],
  timestamp = new Date().toISOString(),
): MonitorPatchPayload {
  return {
    type: "patch",
    timestamp,
    upsert: sortMonitorClients(upsert),
    remove: [...new Set(remove)].sort((a, b) => a.localeCompare(b)),
  };
}

export function readMonitorClient(value: unknown): MonitorClient | null {
  if (!isRecord(value)) return null;
  if (typeof value.runtimeID !== "string" || !value.runtimeID.trim()) return null;
  if (!isMonitorRuntimeStatus(value.status)) return null;
  if (!isMonitorSessionState(value.sessionState)) return null;
  if (!isMonitorSessionReason(value.sessionReason)) return null;
  if (value.sessionMeta !== null && !isRecord(value.sessionMeta)) return null;

  const sessionID = readNullableString(value.sessionID);
  const displayID = readNullableString(value.displayID);
  const instanceWorkspaceDirectory = readNullableString(value.instanceWorkspaceDirectory);
  const activeCountRaw = Number(value.activeCount);
  const activeCount = Number.isFinite(activeCountRaw) ? Math.max(0, Math.floor(activeCountRaw)) : 0;

  return {
    key: typeof value.key === "string" && value.key.trim()
      ? value.key
      : createMonitorClientKey({
          runtimeID: value.runtimeID,
          sessionID,
          displayID,
          instanceWorkspaceDirectory,
        }),
    runtimeID: value.runtimeID,
    sessionID,
    displayID,
    runtimeHost: readNullableString(value.runtimeHost),
    instanceWorkspaceDirectory,
    title: readNullableString(value.title),
    status: value.status,
    sessionState: value.sessionState,
    sessionReason: value.sessionReason,
    sessionMeta: value.sessionMeta && isRecord(value.sessionMeta) ? value.sessionMeta : null,
    lastActiveTime: readNullableString(value.lastActiveTime),
    activeCount,
  };
}

export function readMonitorStreamPayload(value: unknown): MonitorStreamPayload | null {
  if (!isRecord(value)) return null;
  if (typeof value.timestamp !== "string") return null;

  if (value.type === "snapshot") {
    if (!Array.isArray(value.data)) return null;
    const data: MonitorClient[] = [];
    for (const item of value.data) {
      const client = readMonitorClient(item);
      if (!client) return null;
      data.push(client);
    }
    return {
      type: "snapshot",
      timestamp: value.timestamp,
      data: sortMonitorClients(data),
    };
  }

  if (value.type === "patch") {
    if (!Array.isArray(value.upsert) || !Array.isArray(value.remove)) return null;
    const upsert: MonitorClient[] = [];
    for (const item of value.upsert) {
      const client = readMonitorClient(item);
      if (!client) return null;
      upsert.push(client);
    }
    const remove: string[] = [];
    for (const item of value.remove) {
      if (typeof item !== "string" || !item.trim()) return null;
      remove.push(item);
    }
    return {
      type: "patch",
      timestamp: value.timestamp,
      upsert: sortMonitorClients(upsert),
      remove,
    };
  }

  return null;
}

export function applyMonitorPatch(current: MonitorClient[], payload: MonitorStreamPayload): MonitorClient[] {
  if (payload.type === "snapshot") {
    return sortMonitorClients(payload.data);
  }

  const next = new Map<string, MonitorClient>();
  for (const client of current) {
    next.set(client.key, client);
  }
  for (const key of payload.remove) {
    next.delete(key);
  }
  for (const client of payload.upsert) {
    next.set(client.key, client);
  }
  return sortMonitorClients([...next.values()]);
}
