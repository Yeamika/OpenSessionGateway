import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

import type { NextRequest } from "next/server";

import {
  getRuntimeBundle,
  getRuntimeSessionBundle,
} from "@/lib/runtime-hub";
import {
  getManagedRuntimePermission,
  listManagedRuntimePermissions,
  listRuntimeClients,
  listRuntimeManagedSessions,
  type RuntimeClient,
} from "@/lib/runtime-store";
import {
  hasOnlineRuntime,
  hasOnlineRuntimeSession,
  requireOnlineRuntime,
  requireOnlineRuntimeSession,
} from "@/lib/runtime-validation";
import { listRuntimeInstanceWorkspaces } from "@/lib/ClientModel/instance-workspace/registry";
import type { McpPlugin, McpPluginInfo } from "@/lib/plugins/mcp/types";

type CleanupFn = () => void | Promise<void>;

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

type BasicWorkerHookName = "runtime_connect" | "runtime_disconnect" | "ws_event";
type WorkerHookName = BasicWorkerHookName | "session_status_change";

type WorkerRequestSnapshot = {
  method: string;
  url: string;
  headers: Record<string, string>;
};

type WorkerResponseSnapshot = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

type WorkerHostRequestMessage = {
  type: "host_request";
  requestID: number;
  action:
    | "register_surface"
    | "subscribe_hook"
    | "unsubscribe_hook"
    | "storage_get"
    | "storage_set"
    | "storage_delete"
    | "storage_list"
    | "osg_list_runtime_clients"
    | "osg_require_online_runtime"
    | "osg_list_runtime_managed_sessions"
    | "osg_list_runtime_instance_workspaces"
    | "osg_request_runtime"
    | "osg_request_session_list"
    | "osg_create_new_session"
    | "osg_rename_client_session"
    | "osg_set_client_display_session"
    | "osg_abort_client_session"
    | "osg_list_available_models"
    | "osg_get_session_last_used_model"
    | "osg_reload_client_instance_workspace"
    | "osg_list_runtime_permissions"
    | "osg_get_runtime_permission"
    | "osg_resolve_runtime_permission"
    | "osg_has_online_runtime"
    | "osg_has_online_runtime_session"
    | "osg_require_online_runtime_session"
    | "osg_add_prompt"
    | "osg_get_session_messages"
    | "osg_show_toast";
  payload: Record<string, unknown>;
};

type WorkerHostReplyMessage = {
  type: "host_reply";
  requestID: number;
  ok: boolean;
  result?: unknown;
  error?: string;
};

type WorkerRpcResultMessage = {
  type: "rpc_result";
  rpcID: number;
  response: WorkerResponseSnapshot;
};

type WorkerRpcErrorMessage = {
  type: "rpc_error";
  rpcID: number;
  error: string;
};

type WorkerLogMessage = {
  type: "log";
  level: "info" | "warn" | "error";
  message: string;
  extra?: Record<string, unknown>;
};

type WorkerLoadedMessage = {
  type: "loaded";
  manifest: OsgServerPluginManifest;
};

type WorkerActivatedMessage = {
  type: "activated";
};

type WorkerActivationFailedMessage = {
  type: "activation_failed";
  error: string;
};

type WorkerDeactivatedMessage = {
  type: "deactivated";
};

type WorkerIncomingMessage =
  | WorkerHostRequestMessage
  | WorkerRpcResultMessage
  | WorkerRpcErrorMessage
  | WorkerLogMessage
  | WorkerLoadedMessage
  | WorkerActivatedMessage
  | WorkerActivationFailedMessage
  | WorkerDeactivatedMessage;

type WorkerPendingRpc = {
  resolve: (response: Response) => void;
  reject: (reason: Error) => void;
};

type SessionStatusHookRecord = HookRecord<(event: SessionStatusChangeEvent) => void | Promise<void>> & {
  target: SessionStatusHookTarget;
  targetKey: string;
  options: SessionStatusWatchOptions;
};

type WorkerSessionStatusSubscription = {
  subscriptionID: string;
  target: SessionStatusHookTarget;
  targetKey: string;
  options: SessionStatusWatchOptions;
};

export type PluginSource =
  | {
      kind: "builtin";
    }
  | {
      kind: "file";
      requestedPath: string;
      absolutePath: string;
      sourcePath: string;
    }
  | {
      kind: "package";
      packageName: string;
      packagePath: string;
      absolutePath: string;
    };

export type RuntimeConnectEvent = {
  runtimeID: string;
  hostName: string;
  connectedAt: string;
};

export type RuntimeDisconnectEvent = {
  runtimeID: string;
  hostName: string;
  connectedAt: string;
  lastActiveAt: string;
};

export type RuntimeWsEvent = {
  runtimeID: string;
  hostName: string;
  type: string;
  requestID: string;
  data: unknown;
  receivedAt: string;
};

export type SessionStatusHookTarget = {
  runtimeID: string;
  sessionID: string;
};

export type SessionStatusWatchOptions = {
  emitCurrent?: boolean;
};

export type SessionStatusSnapshot = {
  runtimeID: string;
  sessionID: string;
  runtimeStatus: "online" | "offline";
  sessionStatus: "idle" | "busy" | "error" | null;
  currentStatus: string | null;
  title: string | null;
  displayID: string | null;
  instanceWorkspaceDirectory: string | null;
  runtimeHost: string | null;
  lastActiveTime: string | null;
  updatedAt: string;
};

export type SessionStatusChangeField =
  | "runtimeStatus"
  | "sessionStatus"
  | "currentStatus"
  | "title"
  | "displayID"
  | "instanceWorkspaceDirectory"
  | "runtimeHost";

export type SessionStatusChangeEvent = {
  kind: "snapshot" | "change" | "resync" | "disconnect";
  source: "snapshot" | "client_content" | "runtime_connect" | "runtime_disconnect";
  current: SessionStatusSnapshot;
  previous: SessionStatusSnapshot | null;
  changed: SessionStatusChangeField[];
};

export type SessionStatusChangeHook = {
  (target: SessionStatusHookTarget, listener: (event: SessionStatusChangeEvent) => void | Promise<void>): () => void;
  (
    target: SessionStatusHookTarget,
    options: SessionStatusWatchOptions,
    listener: (event: SessionStatusChangeEvent) => void | Promise<void>,
  ): () => void;
};

export type OsgServerPluginManifest = {
  id: string;
  version: string;
  name?: string;
  description?: string;
};

export type PluginRuntimeClient = RuntimeClient & {
  currentStatus: string | null;
};

export type PluginManagedSession = {
  sessionID: string;
  lastActiveTime: string | null;
  activeCount: number;
};

export type PluginRequestRuntimeResult = {
  ok: boolean;
  runtimeID: string;
  synced: boolean;
  session: {
    requested: boolean;
    exists: boolean;
    sessionID: string;
    title?: string;
    status?: "idle" | "busy" | "error" | null;
    displayID?: string | null;
  };
  currentStatus?: string | null;
  error?: string;
};

export type PluginInstanceWorkspace = {
  runtimeID: string;
  instanceWorkspaceDirectory: string | null;
  title: string | null;
};

export type PluginPermissionStatus =
  | "created"
  | "pending"
  | "approved"
  | "denied"
  | "cancelled"
  | "expired"
  | "superseded"
  | "failed";

export type PluginPermissionDecision = "approve" | "deny" | "cancel";

export type PluginRuntimePermission = {
  permissionID: string;
  runtimeID: string;
  sessionID: string | null;
  displayID: string | null;
  kind: string;
  title: string;
  description: string | null;
  detail: unknown;
  choices: Array<{ value: PluginPermissionDecision; label?: string }>;
  defaultAction: PluginPermissionDecision | null;
  status: PluginPermissionStatus;
  requestedAt: string;
  updatedAt: string;
  expiresAt: string | null;
  resolvedAt: string | null;
  actor: string | null;
  reason: string | null;
  message: string | null;
  correlationID: string | null;
  dedupeKey: string | null;
  supersedesPermissionID: string | null;
  supersededByPermissionID: string | null;
};

export type PluginStorageEntry<T = unknown> = {
  key: string;
  value: T;
};

export type PluginStorageApi = {
  get: <T = unknown>(key: string) => Promise<T | null>;
  set: <T = unknown>(key: string, value: T) => Promise<T>;
  delete: (key: string) => Promise<boolean>;
  list: <T = unknown>(prefix?: string) => Promise<Array<PluginStorageEntry<T>>>;
};

export type PluginOsgApi = {
  listRuntimeClients: () => Promise<PluginRuntimeClient[]>;
  requireOnlineRuntime: (runtimeID: string) => Promise<void>;
  listRuntimeManagedSessions: (runtimeID: string) => Promise<PluginManagedSession[]>;
  listRuntimeInstanceWorkspaces: (runtimeID: string) => Promise<PluginInstanceWorkspace[]>;
  requestRuntime: (payload: {
    runtimeID: string;
    sessionID: string;
  }) => Promise<PluginRequestRuntimeResult>;
  requestSessionList: (payload: {
    runtimeID: string;
    list?: number;
    regex?: string;
  }) => Promise<{ meta: { matched: number }; sessions: Array<{ id: string; title?: string; status?: string; time?: string }> }>;
  createNewSession: (payload: {
    runtimeID: string;
    instanceWorkspaceDirectory: string;
    content: string;
    title?: string;
    model?: string;
    displayID?: string;
  }) => Promise<unknown>;
  renameClientSession: (payload: {
    runtimeID: string;
    sessionID: string;
    title: string;
  }) => Promise<{ ok: boolean; sessionID: string; title: string }>;
  setClientDisplaySession: (payload: {
    runtimeID: string;
    displayID: string;
    sessionID: string;
  }) => Promise<{ ok: boolean; displayID: string; sessionID: string }>;
  abortClientSession: (payload: {
    runtimeID: string;
    sessionID: string;
  }) => Promise<{ ok: boolean; aborted: boolean; sessionID: string }>;
  listAvailableModels: (payload: {
    runtimeID: string;
    list?: number;
    regex?: string;
  }) => Promise<{ realsize: number; list: Array<{ providerID: string; modelID: string; name: string; id: string }> }>;
  getSessionLastUsedModel: (payload: {
    runtimeID: string;
    sessionID: string;
  }) => Promise<{ runtimeID: string; sessionID: string; providerID: string; modelID: string; id: string; time: string }>;
  reloadClientInstanceWorkspace: (payload: {
    runtimeID: string;
    instanceWorkspaceDirectory?: string;
    title?: string;
  }) => Promise<{ ok: boolean; instanceWorkspaceDirectory?: string; title?: string; reloaded?: boolean; error?: string }>;
  listRuntimePermissions: (payload: {
    runtimeID: string;
    sessionID?: string;
    status?: PluginPermissionStatus;
    list?: number;
  }) => Promise<{ realsize: number; list: PluginRuntimePermission[] }>;
  getRuntimePermission: (payload: {
    runtimeID: string;
    permissionID: string;
  }) => Promise<PluginRuntimePermission | null>;
  resolveRuntimePermission: (payload: {
    runtimeID: string;
    permissionID: string;
    action: PluginPermissionDecision;
    reason?: string;
    actor?: string;
    correlationID?: string;
  }) => Promise<{ ok: boolean; permissionID: string; action: PluginPermissionDecision; error?: string }>;
  hasOnlineRuntime: (runtimeID: string) => Promise<boolean>;
  hasOnlineRuntimeSession: (runtimeID: string, sessionID: string) => Promise<boolean>;
  requireOnlineRuntimeSession: (runtimeID: string, sessionID: string) => Promise<void>;
  addPrompt: (payload: {
    runtimeID: string;
    sessionID: string;
    msg: string;
    model?: string;
    system?: string;
  }) => Promise<{ ok: boolean; model: string | null; sessionID: string; error?: string }>;
  getSessionMessages: (payload: {
    runtimeID: string;
    sessionID: string;
    size?: number;
    regex?: string;
  }) => Promise<{ runtimeID: string; sessionID: string; realsize: number; list: Array<Record<string, unknown>>; status: string }>;
  showToast: (payload: {
    runtimeID: string;
    displayID: string;
    title: string;
    message: string;
    subtitle?: string;
    variant?: "info" | "success" | "error";
    durationMs?: number;
  }) => Promise<void>;
};

export type PluginContext = {
  pluginID: string;
  manifest: OsgServerPluginManifest;
  source: PluginSource;
  cleanup: (fn: CleanupFn) => void;
  log: (level: "info" | "warn" | "error", message: string, extra?: Record<string, unknown>) => void;
  mcp: {
    registerSurface: (surface: McpPlugin) => void;
  };
  osg: PluginOsgApi;
  storage: PluginStorageApi;
  hooks: {
    onRuntimeConnect: (listener: (event: RuntimeConnectEvent) => void | Promise<void>) => () => void;
    onRuntimeDisconnect: (listener: (event: RuntimeDisconnectEvent) => void | Promise<void>) => () => void;
    onWsEvent: (listener: (event: RuntimeWsEvent) => void | Promise<void>) => () => void;
    onSessionStatusChange: SessionStatusChangeHook;
  };
};

export type OsgServerPlugin = {
  manifest: OsgServerPluginManifest;
  activate: (context: PluginContext) => void | CleanupFn | Promise<void | CleanupFn>;
};

export type PluginSummary = {
  id: string;
  version: string;
  name: string;
  description: string;
  sourceKind: PluginSource["kind"];
  sourcePath: string | null;
  sourceSpecifier: string | null;
  locked: boolean;
  loadedAt: string;
  routeSegments: string[];
};

type PluginRecordBase = {
  manifest: OsgServerPluginManifest;
  source: PluginSource;
  locked: boolean;
  loadedAt: string;
  active: boolean;
};

type InProcessPluginRecord = PluginRecordBase & {
  kind: "in-process";
  cleanups: CleanupFn[];
};

type WorkerPluginRecord = PluginRecordBase & {
  kind: "worker";
  worker: Worker;
  pendingRpcCalls: Map<number, WorkerPendingRpc>;
  nextRpcID: number;
  routeSegments: Set<string>;
  subscriptions: Record<BasicWorkerHookName, boolean>;
  sessionStatusSubscriptions: Map<string, WorkerSessionStatusSubscription>;
  unloading: boolean;
  messageHandler: (message: unknown) => void;
  errorHandler: (error: Error) => void;
  exitHandler: (code: number) => void;
  deactivation: Deferred<void> | null;
};

type PluginRecord = InProcessPluginRecord | WorkerPluginRecord;

type HookRecord<T> = {
  ownerPluginID: string;
  callback: T;
};

type PluginHostState = {
  plugins: Map<string, PluginRecord>;
  pluginStorage: Map<string, Map<string, unknown>>;
  mcpSurfaces: Map<string, { ownerPluginID: string; surface: McpPlugin }>;
  runtimeConnectHooks: Map<string, HookRecord<(event: RuntimeConnectEvent) => void | Promise<void>>>;
  runtimeDisconnectHooks: Map<string, HookRecord<(event: RuntimeDisconnectEvent) => void | Promise<void>>>;
  wsEventHooks: Map<string, HookRecord<(event: RuntimeWsEvent) => void | Promise<void>>>;
  sessionStatusHooks: Map<string, SessionStatusHookRecord>;
  sessionStatusSnapshots: Map<string, SessionStatusSnapshot>;
  hookSequence: number;
};

const globalForPluginHost = globalThis as unknown as {
  __osgPluginHostState?: PluginHostState;
};

if (!globalForPluginHost.__osgPluginHostState) {
  globalForPluginHost.__osgPluginHostState = {
    plugins: new Map<string, PluginRecord>(),
    pluginStorage: new Map<string, Map<string, unknown>>(),
    mcpSurfaces: new Map<string, { ownerPluginID: string; surface: McpPlugin }>(),
    runtimeConnectHooks: new Map<string, HookRecord<(event: RuntimeConnectEvent) => void | Promise<void>>>(),
    runtimeDisconnectHooks: new Map<string, HookRecord<(event: RuntimeDisconnectEvent) => void | Promise<void>>>(),
    wsEventHooks: new Map<string, HookRecord<(event: RuntimeWsEvent) => void | Promise<void>>>(),
    sessionStatusHooks: new Map<string, SessionStatusHookRecord>(),
    sessionStatusSnapshots: new Map<string, SessionStatusSnapshot>(),
    hookSequence: 0,
  };
}

const hostState = globalForPluginHost.__osgPluginHostState;

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function pluginLog(pluginID: string, level: "info" | "warn" | "error", message: string, extra?: Record<string, unknown>) {
  const prefix = `[plugin:${pluginID}] ${message}`;
  if (level === "error") {
    console.error(prefix, extra || {});
    return;
  }
  if (level === "warn") {
    console.warn(prefix, extra || {});
    return;
  }
  console.log(prefix, extra || {});
}

function normalizeManifest(value: OsgServerPluginManifest): OsgServerPluginManifest {
  const id = typeof value?.id === "string" ? value.id.trim() : "";
  const version = typeof value?.version === "string" ? value.version.trim() : "";
  if (!id) throw new Error("plugin manifest.id is required");
  if (!version) throw new Error(`plugin ${id} manifest.version is required`);
  return {
    id,
    version,
    name: typeof value?.name === "string" ? value.name.trim() : undefined,
    description: typeof value?.description === "string" ? value.description.trim() : undefined,
  };
}

function clonePluginValue<T>(value: T): T {
  return typeof value === "undefined" ? value : structuredClone(value);
}

function storageMapForPlugin(pluginID: string): Map<string, unknown> {
  const clean = pluginID.trim();
  if (!clean) {
    throw new Error("pluginID is required for storage access");
  }
  let store = hostState.pluginStorage.get(clean);
  if (!store) {
    store = new Map<string, unknown>();
    hostState.pluginStorage.set(clean, store);
  }
  return store;
}

function normalizeStorageKey(key: string): string {
  const clean = key.trim();
  if (!clean) {
    throw new Error("storage key is required");
  }
  return clean;
}

function createStorageApi(pluginID: string): PluginStorageApi {
  return {
    async get<T = unknown>(key: string): Promise<T | null> {
      const store = storageMapForPlugin(pluginID);
      const value = store.get(normalizeStorageKey(key));
      return typeof value === "undefined" ? null : clonePluginValue(value as T);
    },
    async set<T = unknown>(key: string, value: T): Promise<T> {
      const store = storageMapForPlugin(pluginID);
      const cloned = clonePluginValue(value);
      store.set(normalizeStorageKey(key), cloned);
      return clonePluginValue(cloned);
    },
    async delete(key: string): Promise<boolean> {
      const store = storageMapForPlugin(pluginID);
      return store.delete(normalizeStorageKey(key));
    },
    async list<T = unknown>(prefix = ""): Promise<Array<PluginStorageEntry<T>>> {
      const store = storageMapForPlugin(pluginID);
      const cleanPrefix = prefix.trim();
      return [...store.entries()]
        .filter(([key]) => !cleanPrefix || key.startsWith(cleanPrefix))
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, value]) => ({
          key,
          value: clonePluginValue(value as T),
        }));
    },
  };
}

async function requestAddPromptViaRuntime(payload: {
  runtimeID: string;
  sessionID: string;
  msg: string;
  model?: string;
  system?: string;
}) {
  const { requestAddPromot } = await import("@/lib/v2/ws");
  return requestAddPromot(
    payload.runtimeID,
    payload.sessionID,
    payload.msg,
    payload.model,
    payload.system,
  );
}

async function requestSessionMessagesViaRuntime(payload: {
  runtimeID: string;
  sessionID: string;
  size?: number;
  regex?: string;
}) {
  await requireOnlineRuntimeSession(payload.runtimeID, payload.sessionID);
  const { requestGetSessionMsg } = await import("@/lib/v2/ws");
  return requestGetSessionMsg(
    payload.runtimeID,
    payload.sessionID,
    payload.size || 10,
    payload.regex,
  );
}

async function requestSessionListViaRuntime(payload: {
  runtimeID: string;
  list?: number;
  regex?: string;
}) {
  const { requestSessionList } = await import("@/lib/v2/ws");
  return requestSessionList(payload.runtimeID, payload.list || 10, payload.regex);
}

async function requestCreateNewSessionViaRuntime(payload: {
  runtimeID: string;
  instanceWorkspaceDirectory: string;
  content: string;
  title?: string;
  model?: string;
  displayID?: string;
}) {
  const { requestCreateNewSession } = await import("@/lib/v2/ws");
  return requestCreateNewSession(payload.runtimeID, {
    ...payload,
  });
}

async function requestRenameClientSessionViaRuntime(payload: {
  runtimeID: string;
  sessionID: string;
  title: string;
}) {
  const { requestRenameSessionOfClient } = await import("@/lib/v2/ws");
  return requestRenameSessionOfClient(payload.runtimeID, payload.sessionID, payload.title);
}

async function requestSetClientDisplaySessionViaRuntime(payload: {
  runtimeID: string;
  displayID: string;
  sessionID: string;
}) {
  const { requestSetClientDisplaySession } = await import("@/lib/v2/ws");
  return requestSetClientDisplaySession(payload.runtimeID, payload.displayID, payload.sessionID);
}

async function requestAbortClientSessionViaRuntime(payload: {
  runtimeID: string;
  sessionID: string;
}) {
  const { requestAbortSessionOfClient } = await import("@/lib/v2/ws");
  return requestAbortSessionOfClient(payload.runtimeID, payload.sessionID);
}

async function requestListAvailableModelsViaRuntime(payload: {
  runtimeID: string;
  list?: number;
  regex?: string;
}) {
  const { requestListAvailableModels } = await import("@/lib/v2/ws");
  return requestListAvailableModels(payload.runtimeID, payload.list || 10, payload.regex);
}

async function requestLastUsedModelViaRuntime(payload: {
  runtimeID: string;
  sessionID: string;
}) {
  const { requestLastUsedModelOfSession } = await import("@/lib/v2/ws");
  return requestLastUsedModelOfSession(payload.runtimeID, payload.sessionID);
}

async function requestInstanceWorkspaceReloadViaRuntime(payload: {
  runtimeID: string;
  instanceWorkspaceDirectory?: string;
  title?: string;
}) {
  const { requestInstanceWorkspaceReload } = await import("@/lib/v2/ws");
  return requestInstanceWorkspaceReload(payload.runtimeID, {
    instanceWorkspaceDirectory: payload.instanceWorkspaceDirectory,
    title: payload.title,
  });
}

async function requestResolvePermissionViaRuntime(payload: {
  runtimeID: string;
  permissionID: string;
  action: PluginPermissionDecision;
  reason?: string;
  actor?: string;
  correlationID?: string;
}) {
  await requireOnlineRuntime(payload.runtimeID);
  const { requestResolvePermission } = await import("@/lib/v2/ws");
  return requestResolvePermission(payload.runtimeID, payload);
}

async function sendServerToastViaRuntime(payload: {
  runtimeID: string;
  displayID: string;
  title: string;
  message: string;
  subtitle?: string;
  variant?: "info" | "success" | "error";
  durationMs?: number;
}): Promise<void> {
  const { sendServerToast } = await import("@/lib/v2/ws");
  await sendServerToast(payload.runtimeID, payload);
}

async function listPluginRuntimeClients(): Promise<PluginRuntimeClient[]> {
  const clients = await listRuntimeClients();
  const { readV2RuntimeCurrentStatus } = await import("@/lib/v2/ws");
  return clients.map((item) => ({
    ...item,
    currentStatus: readV2RuntimeCurrentStatus(item.runtimeID),
  }));
}

async function listPluginRuntimeInstanceWorkspaces(runtimeID: string): Promise<PluginInstanceWorkspace[]> {
  return listRuntimeInstanceWorkspaces(runtimeID).map((item) => ({
    runtimeID: item.runtimeID,
    instanceWorkspaceDirectory: item.instanceWorkspaceDirectory,
    title: item.title,
  }));
}

async function listPluginRuntimePermissions(payload: {
  runtimeID: string;
  sessionID?: string;
  status?: PluginPermissionStatus;
  list?: number;
}): Promise<{ realsize: number; list: PluginRuntimePermission[] }> {
  const list = await listManagedRuntimePermissions(payload.runtimeID, {
    sessionID: payload.sessionID,
    status: payload.status,
  });
  const maxLen = Number.isInteger(payload.list) && Number(payload.list) > 0 ? Number(payload.list) : 20;
  return { realsize: list.length, list: list.slice(0, maxLen) };
}

async function getPluginRuntimePermission(payload: {
  runtimeID: string;
  permissionID: string;
}): Promise<PluginRuntimePermission | null> {
  return getManagedRuntimePermission(payload.runtimeID, payload.permissionID);
}

async function requestRuntimeViaRuntime(payload: {
  runtimeID: string;
  sessionID: string;
}): Promise<PluginRequestRuntimeResult> {
  await requireOnlineRuntime(payload.runtimeID);
  const { requestRuntime } = await import("@/lib/v2/ws");
  return requestRuntime(payload.runtimeID, payload);
}

function createOsgApi(): PluginOsgApi {
  return {
    async listRuntimeClients() {
      return listPluginRuntimeClients();
    },
    async requireOnlineRuntime(runtimeID: string) {
      await requireOnlineRuntime(runtimeID);
    },
    async listRuntimeManagedSessions(runtimeID: string) {
      return listRuntimeManagedSessions(runtimeID);
    },
    async listRuntimeInstanceWorkspaces(runtimeID: string) {
      return listPluginRuntimeInstanceWorkspaces(runtimeID);
    },
    async requestRuntime(payload) {
      return requestRuntimeViaRuntime(payload);
    },
    async requestSessionList(payload) {
      return requestSessionListViaRuntime(payload);
    },
    async createNewSession(payload) {
      return requestCreateNewSessionViaRuntime(payload);
    },
    async renameClientSession(payload) {
      return requestRenameClientSessionViaRuntime(payload);
    },
    async setClientDisplaySession(payload) {
      return requestSetClientDisplaySessionViaRuntime(payload);
    },
    async abortClientSession(payload) {
      return requestAbortClientSessionViaRuntime(payload);
    },
    async listAvailableModels(payload) {
      return requestListAvailableModelsViaRuntime(payload);
    },
    async getSessionLastUsedModel(payload) {
      return requestLastUsedModelViaRuntime(payload);
    },
    async reloadClientInstanceWorkspace(payload) {
      return requestInstanceWorkspaceReloadViaRuntime(payload);
    },
    async listRuntimePermissions(payload) {
      return listPluginRuntimePermissions(payload);
    },
    async getRuntimePermission(payload) {
      return getPluginRuntimePermission(payload);
    },
    async resolveRuntimePermission(payload) {
      return requestResolvePermissionViaRuntime(payload);
    },
    async hasOnlineRuntime(runtimeID: string) {
      return hasOnlineRuntime(runtimeID);
    },
    async hasOnlineRuntimeSession(runtimeID: string, sessionID: string) {
      return hasOnlineRuntimeSession(runtimeID, sessionID);
    },
    async requireOnlineRuntimeSession(runtimeID: string, sessionID: string) {
      await requireOnlineRuntimeSession(runtimeID, sessionID);
    },
    async addPrompt(payload) {
      return requestAddPromptViaRuntime(payload);
    },
    async getSessionMessages(payload) {
      return requestSessionMessagesViaRuntime(payload);
    },
    async showToast(payload) {
      await sendServerToastViaRuntime(payload);
    },
  };
}

function isWorkerRecord(record: PluginRecord): record is WorkerPluginRecord {
  return record.kind === "worker";
}

function routeSegmentsForPlugin(pluginID: string): string[] {
  const list: string[] = [];
  for (const [routeSegment, entry] of hostState.mcpSurfaces.entries()) {
    if (entry.ownerPluginID === pluginID) list.push(routeSegment);
  }
  return list.sort();
}

function toPluginSummary(record: PluginRecord): PluginSummary {
  return {
    id: record.manifest.id,
    version: record.manifest.version,
    name: record.manifest.name || record.manifest.id,
    description: record.manifest.description || "",
    sourceKind: record.source.kind,
    sourcePath:
      record.source.kind === "file"
        ? record.source.sourcePath
        : record.source.kind === "package"
          ? record.source.packagePath
          : null,
    sourceSpecifier:
      record.source.kind === "file"
        ? record.source.requestedPath
        : record.source.kind === "package"
          ? record.source.packageName
          : null,
    locked: record.locked,
    loadedAt: record.loadedAt,
    routeSegments: routeSegmentsForPlugin(record.manifest.id),
  };
}

function ensureInProcessRecordActive(record: InProcessPluginRecord): void {
  if (!record.active) {
    throw new Error(`plugin is no longer active: ${record.manifest.id}`);
  }
}

function addCleanup(record: InProcessPluginRecord, fn: CleanupFn): void {
  let called = false;
  record.cleanups.push(async () => {
    if (called) return;
    called = true;
    await fn();
  });
}

function registerHook<T>(
  record: InProcessPluginRecord,
  store: Map<string, HookRecord<T>>,
  callback: T,
): () => void {
  ensureInProcessRecordActive(record);
  hostState.hookSequence += 1;
  const token = `${record.manifest.id}:${hostState.hookSequence}`;
  store.set(token, { ownerPluginID: record.manifest.id, callback });

  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    store.delete(token);
  };

  addCleanup(record, remove);
  return remove;
}

function normalizeSessionStatusHookTarget(target: SessionStatusHookTarget): SessionStatusHookTarget {
  const runtimeID = typeof target?.runtimeID === "string" ? target.runtimeID.trim() : "";
  const sessionID = typeof target?.sessionID === "string" ? target.sessionID.trim() : "";
  if (!runtimeID) throw new Error("runtimeID is required");
  if (!sessionID) throw new Error("sessionID is required");
  return { runtimeID, sessionID };
}

function normalizeSessionStatusWatchOptions(options?: SessionStatusWatchOptions | null): SessionStatusWatchOptions {
  return {
    emitCurrent: options?.emitCurrent === true,
  };
}

function sessionStatusTargetKey(target: SessionStatusHookTarget): string {
  return `${target.runtimeID.trim()}::${target.sessionID.trim()}`;
}

function sessionStatusFingerprint(snapshot: SessionStatusSnapshot): string {
  return JSON.stringify({
    runtimeStatus: snapshot.runtimeStatus,
    sessionStatus: snapshot.sessionStatus,
    currentStatus: snapshot.currentStatus,
    title: snapshot.title,
    displayID: snapshot.displayID,
    instanceWorkspaceDirectory: snapshot.instanceWorkspaceDirectory,
    runtimeHost: snapshot.runtimeHost,
  });
}

function sessionStatusChangedFields(previous: SessionStatusSnapshot | null, current: SessionStatusSnapshot): SessionStatusChangeField[] {
  if (!previous) {
    return [];
  }
  const changed: SessionStatusChangeField[] = [];
  const fields: SessionStatusChangeField[] = [
    "runtimeStatus",
    "sessionStatus",
    "currentStatus",
    "title",
    "displayID",
    "instanceWorkspaceDirectory",
    "runtimeHost",
  ];
  for (const field of fields) {
    if (previous[field] !== current[field]) changed.push(field);
  }
  return changed;
}

async function resolveSessionStatusSnapshot(target: SessionStatusHookTarget): Promise<SessionStatusSnapshot | null> {
  const normalized = normalizeSessionStatusHookTarget(target);
  const clients = await listRuntimeClients();
  const current = clients.find((item) => item.runtimeID === normalized.runtimeID && item.sessionID === normalized.sessionID) || null;
  const session = getRuntimeSessionBundle(normalized.runtimeID, normalized.sessionID);
  const runtime = getRuntimeBundle(normalized.runtimeID);
  if (!current && !session && !runtime) return null;
  const instanceWorkspaceDirectory = current?.instanceWorkspaceDirectory
    ?? null;
  const { readV2RuntimeCurrentStatus } = await import("@/lib/v2/ws");
  const updatedAt =
    current?.updatedAt
    || session?.lastActiveTime
    || runtime?.wsBridge.lastSeenAt
    || runtime?.wsBridge.connectedAt
    || new Date().toISOString();

  return {
    runtimeID: normalized.runtimeID,
    sessionID: normalized.sessionID,
    runtimeStatus: current?.status || (runtime?.wsBridge.connected ? "online" : "offline"),
    sessionStatus: current?.sessionStatus ?? session?.status ?? null,
    currentStatus: readV2RuntimeCurrentStatus(normalized.runtimeID),
    title: current?.title ?? session?.title ?? null,
    displayID: current?.displayID ?? session?.displayID ?? null,
    instanceWorkspaceDirectory,
    runtimeHost: current?.runtimeHost ?? runtime?.wsBridge.hostName ?? null,
    lastActiveTime: session?.lastActiveTime ?? current?.lastActiveTime ?? runtime?.wsBridge.lastSeenAt ?? null,
    updatedAt,
  };
}

function emitWorkerSessionStatusEvent(
  record: WorkerPluginRecord,
  subscriptionID: string,
  event: SessionStatusChangeEvent,
): void {
  if (!record.active || record.unloading || !record.sessionStatusSubscriptions.has(subscriptionID)) return;
  record.worker.postMessage({
    type: "event",
    hook: "session_status_change",
    payload: {
      subscriptionID,
      event,
    },
  });
}

async function dispatchSessionStatusEvent(targetKey: string, event: SessionStatusChangeEvent): Promise<void> {
  for (const item of hostState.sessionStatusHooks.values()) {
    if (item.targetKey !== targetKey) continue;
    try {
      await item.callback(event);
    } catch (error) {
      pluginLog(
        item.ownerPluginID,
        "error",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  for (const record of hostState.plugins.values()) {
    if (!isWorkerRecord(record)) continue;
    for (const subscription of record.sessionStatusSubscriptions.values()) {
      if (subscription.targetKey !== targetKey) continue;
      emitWorkerSessionStatusEvent(record, subscription.subscriptionID, event);
    }
  }
}

async function emitCurrentSessionStatusToInProcessHook(item: SessionStatusHookRecord): Promise<void> {
  if (item.options.emitCurrent !== true) return;
  const current = await resolveSessionStatusSnapshot(item.target);
  if (!current) return;
  hostState.sessionStatusSnapshots.set(item.targetKey, current);
  await item.callback({
    kind: "snapshot",
    source: "snapshot",
    current,
    previous: null,
    changed: [],
  });
}

async function emitCurrentSessionStatusToWorkerSubscription(
  record: WorkerPluginRecord,
  subscription: WorkerSessionStatusSubscription,
): Promise<void> {
  if (subscription.options.emitCurrent !== true) return;
  const current = await resolveSessionStatusSnapshot(subscription.target);
  if (!current) return;
  hostState.sessionStatusSnapshots.set(subscription.targetKey, current);
  emitWorkerSessionStatusEvent(record, subscription.subscriptionID, {
    kind: "snapshot",
    source: "snapshot",
    current,
    previous: null,
    changed: [],
  });
}

async function refreshSessionStatusTarget(
  target: SessionStatusHookTarget,
  source: SessionStatusChangeEvent["source"],
): Promise<void> {
  const normalized = normalizeSessionStatusHookTarget(target);
  const targetKey = sessionStatusTargetKey(normalized);
  const current = await resolveSessionStatusSnapshot(normalized);
  if (!current) return;

  const previous = hostState.sessionStatusSnapshots.get(targetKey) || null;
  if (previous && sessionStatusFingerprint(previous) === sessionStatusFingerprint(current)) {
    hostState.sessionStatusSnapshots.set(targetKey, current);
    return;
  }

  hostState.sessionStatusSnapshots.set(targetKey, current);
  const kind: SessionStatusChangeEvent["kind"] =
    source === "runtime_disconnect"
      ? "disconnect"
      : source === "runtime_connect"
        ? "resync"
        : "change";

  await dispatchSessionStatusEvent(targetKey, {
    kind,
    source,
    current,
    previous,
    changed: sessionStatusChangedFields(previous, current),
  });
}

async function refreshRuntimeSessionStatus(runtimeID: string, source: Extract<SessionStatusChangeEvent["source"], "runtime_connect" | "runtime_disconnect">): Promise<void> {
  const clean = runtimeID.trim();
  if (!clean) return;
  const sessions = await listRuntimeManagedSessions(clean);
  for (const session of sessions) {
    if (!session.sessionID) continue;
    await refreshSessionStatusTarget({ runtimeID: clean, sessionID: session.sessionID }, source);
  }
}

function registerSessionStatusHook(
  record: InProcessPluginRecord,
  target: SessionStatusHookTarget,
  options: SessionStatusWatchOptions,
  callback: (event: SessionStatusChangeEvent) => void | Promise<void>,
): () => void {
  ensureInProcessRecordActive(record);
  hostState.hookSequence += 1;
  const token = `${record.manifest.id}:${hostState.hookSequence}`;
  const normalizedTarget = normalizeSessionStatusHookTarget(target);
  const normalizedOptions = normalizeSessionStatusWatchOptions(options);
  hostState.sessionStatusHooks.set(token, {
    ownerPluginID: record.manifest.id,
    callback,
    target: normalizedTarget,
    targetKey: sessionStatusTargetKey(normalizedTarget),
    options: normalizedOptions,
  });

  void emitCurrentSessionStatusToInProcessHook(hostState.sessionStatusHooks.get(token)!);

  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    hostState.sessionStatusHooks.delete(token);
  };

  addCleanup(record, remove);
  return remove;
}

function createProxySurface(
  ownerPluginID: string,
  record: WorkerPluginRecord,
  surfaceID: string,
  routeSegment: string,
  infoSnapshot: McpPluginInfo,
): McpPlugin {
  return {
    id: surfaceID,
    routeSegment,
    info() {
      return infoSnapshot;
    },
    async handleRpc(body, request) {
      const response = await callWorkerRpc(record, routeSegment, body, request);
      return response;
    },
  };
}

function registerMcpSurface(record: InProcessPluginRecord, surface: McpPlugin): void {
  ensureInProcessRecordActive(record);
  const routeSegment = typeof surface.routeSegment === "string" ? surface.routeSegment.trim() : "";
  if (!routeSegment) {
    throw new Error(`plugin ${record.manifest.id} tried to register an empty mcp routeSegment`);
  }
  if (hostState.mcpSurfaces.has(routeSegment)) {
    throw new Error(`mcp routeSegment already registered: ${routeSegment}`);
  }

  hostState.mcpSurfaces.set(routeSegment, {
    ownerPluginID: record.manifest.id,
    surface,
  });

  addCleanup(record, () => {
    const current = hostState.mcpSurfaces.get(routeSegment);
    if (current?.ownerPluginID === record.manifest.id) {
      hostState.mcpSurfaces.delete(routeSegment);
    }
  });
}

function createContext(record: InProcessPluginRecord): PluginContext {
  const sessionStatusHook = ((
    target: SessionStatusHookTarget,
    optionsOrListener: SessionStatusWatchOptions | ((event: SessionStatusChangeEvent) => void | Promise<void>),
    maybeListener?: (event: SessionStatusChangeEvent) => void | Promise<void>,
  ) => {
    const callback = typeof optionsOrListener === "function" ? optionsOrListener : maybeListener;
    if (typeof callback !== "function") {
      throw new Error("onSessionStatusChange listener is required");
    }
    const options = typeof optionsOrListener === "function" ? {} : optionsOrListener;
    return registerSessionStatusHook(record, target, options || {}, callback);
  }) as SessionStatusChangeHook;

  return {
    pluginID: record.manifest.id,
    manifest: record.manifest,
    source: record.source,
    cleanup(fn) {
      ensureInProcessRecordActive(record);
      addCleanup(record, fn);
    },
    log(level, message, extra) {
      pluginLog(record.manifest.id, level, message, extra);
    },
    mcp: {
      registerSurface(surface) {
        registerMcpSurface(record, surface);
      },
    },
    osg: createOsgApi(),
    storage: createStorageApi(record.manifest.id),
    hooks: {
      onRuntimeConnect(listener) {
        return registerHook(record, hostState.runtimeConnectHooks, listener);
      },
      onRuntimeDisconnect(listener) {
        return registerHook(record, hostState.runtimeDisconnectHooks, listener);
      },
      onWsEvent(listener) {
        return registerHook(record, hostState.wsEventHooks, listener);
      },
      onSessionStatusChange: sessionStatusHook,
    },
  };
}

async function disposeInProcessRecord(record: InProcessPluginRecord): Promise<void> {
  record.active = false;
  const cleanupList = [...record.cleanups].reverse();
  record.cleanups.length = 0;
  for (const cleanup of cleanupList) {
    try {
      await cleanup();
    } catch (error) {
      pluginLog(
        record.manifest.id,
        "error",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

async function activateInProcessPlugin(
  plugin: OsgServerPlugin,
  source: PluginSource,
  locked: boolean,
): Promise<PluginSummary> {
  const manifest = normalizeManifest(plugin.manifest);
  if (hostState.plugins.has(manifest.id)) {
    throw new Error(`plugin already loaded: ${manifest.id}`);
  }

  const record: InProcessPluginRecord = {
    kind: "in-process",
    manifest,
    source,
    locked,
    loadedAt: new Date().toISOString(),
    active: true,
    cleanups: [],
  };

  hostState.plugins.set(manifest.id, record);

  try {
    const result = await plugin.activate(createContext(record));
    if (typeof result === "function") {
      addCleanup(record, result);
    }
    pluginLog(manifest.id, "info", "loaded", { source: source.kind });
    return toPluginSummary(record);
  } catch (error) {
    await disposeInProcessRecord(record);
    hostState.plugins.delete(manifest.id);
    throw error;
  }
}

function configuredPluginRoots(): string[] {
  const raw = typeof process.env.OSG_PLUGIN_DIRS === "string" ? process.env.OSG_PLUGIN_DIRS.trim() : "";
  const values = raw
    ? raw.split(path.delimiter).map((item) => item.trim()).filter(Boolean)
    : [
        path.resolve(process.cwd(), "plugins"),
        path.resolve(process.cwd(), "local-plugins"),
        path.resolve(process.cwd(), "server", "local-plugins"),
        path.resolve(process.cwd(), "..", "plugins"),
        path.resolve(process.cwd(), "..", "server", "local-plugins"),
      ];
  return [...new Set(values.map((item) => path.resolve(item)))];
}

function createRuntimeRequire() {
  return createRequire(pathToFileURL(path.join(process.cwd(), "package.json")).href);
}

function isInsideRoot(root: string, targetPath: string): boolean {
  const relative = path.relative(root, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function isFile(targetPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(targetPath);
    return stats.isFile();
  } catch {
    return false;
  }
}

async function isDirectory(targetPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(targetPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

async function findPackageDirectory(startPath: string): Promise<string | null> {
  let current = path.resolve(startPath);
  while (true) {
    if (await isFile(path.join(current, "package.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function readPackageEntryFromDirectory(directoryPath: string): Promise<string | null> {
  const packageJsonPath = path.join(directoryPath, "package.json");
  try {
    const text = await fs.readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(text) as {
      osgServerPlugin?: { entry?: unknown };
      module?: unknown;
      main?: unknown;
    };

    const explicitEntry = parsed.osgServerPlugin && typeof parsed.osgServerPlugin === "object"
      ? parsed.osgServerPlugin.entry
      : undefined;
    if (typeof explicitEntry === "string" && explicitEntry.trim()) {
      return path.resolve(directoryPath, explicitEntry.trim());
    }

    if (typeof parsed.module === "string" && parsed.module.trim()) {
      return path.resolve(directoryPath, parsed.module.trim());
    }

    if (typeof parsed.main === "string" && parsed.main.trim()) {
      return path.resolve(directoryPath, parsed.main.trim());
    }

    return null;
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function appendDefaultEntryCandidates(targetPath: string, candidates: string[]): void {
  candidates.push(`${targetPath}.mjs`);
  candidates.push(`${targetPath}.js`);
  candidates.push(`${targetPath}.cjs`);
  candidates.push(`${targetPath}.ts`);
  candidates.push(`${targetPath}.mts`);
  candidates.push(path.join(targetPath, "index.mjs"));
  candidates.push(path.join(targetPath, "index.js"));
  candidates.push(path.join(targetPath, "index.cjs"));
  candidates.push(path.join(targetPath, "index.ts"));
  candidates.push(path.join(targetPath, "index.mts"));
}

async function resolvePluginEntry(requestedPath: string): Promise<string> {
  const clean = requestedPath.trim();
  if (!clean) throw new Error("plugin path is required");

  const roots = configuredPluginRoots();
  const initialPath = path.isAbsolute(clean) ? clean : path.resolve(roots[0], clean);

  const candidates: string[] = [];
  const initialExt = path.extname(initialPath);
  candidates.push(initialPath);

  if (!initialExt) {
    appendDefaultEntryCandidates(initialPath, candidates);
  }

  if (await isDirectory(initialPath)) {
    const packageEntry = await readPackageEntryFromDirectory(initialPath);
    if (packageEntry) {
      candidates.unshift(packageEntry);
    }
  }

  for (const candidate of candidates) {
    const absolutePath = path.resolve(candidate);
    if (!roots.some((root) => isInsideRoot(root, absolutePath))) {
      continue;
    }
    if (await isFile(absolutePath)) {
      return absolutePath;
    }
  }

  throw new Error(`plugin entry not found or outside allowed roots: ${clean}`);
}

async function resolveInstalledPluginEntry(packageName: string): Promise<{
  packageName: string;
  packagePath: string;
  absolutePath: string;
}> {
  const clean = packageName.trim();
  if (!clean) throw new Error("plugin package name is required");

  let resolvedEntry: string;
  try {
    resolvedEntry = createRuntimeRequire().resolve(clean);
  } catch {
    throw new Error(`plugin package not found: ${clean}`);
  }

  const packagePath = await findPackageDirectory(path.dirname(resolvedEntry));
  if (!packagePath) {
    throw new Error(`plugin package root not found: ${clean}`);
  }

  const explicitEntry = await readPackageEntryFromDirectory(packagePath);
  const absolutePath = explicitEntry ?? path.resolve(resolvedEntry);
  if (!(await isFile(absolutePath))) {
    throw new Error(`plugin package entry not found: ${clean}`);
  }

  return {
    packageName: clean,
    packagePath,
    absolutePath,
  };
}

function workerRuntimePath(): string {
  return path.resolve(process.cwd(), "lib", "plugins", "worker-runtime.mjs");
}

function normalizeWorkerHookName(value: unknown): WorkerHookName {
  if (value === "runtime_connect" || value === "runtime_disconnect" || value === "ws_event" || value === "session_status_change") {
    return value;
  }
  throw new Error(`unknown worker hook: ${String(value || "")}`);
}

function serializeHeaders(headers: Headers): Record<string, string> {
  const values: Record<string, string> = {};
  headers.forEach((value, key) => {
    values[key] = value;
  });
  return values;
}

function snapshotRequest(request: NextRequest): WorkerRequestSnapshot {
  return {
    method: request.method,
    url: request.url,
    headers: serializeHeaders(request.headers),
  };
}

function responseFromSnapshot(snapshot: WorkerResponseSnapshot): Response {
  return new Response(snapshot.body, {
    status: snapshot.status,
    headers: snapshot.headers,
  });
}

function rejectPendingWorkerCalls(record: WorkerPluginRecord, reason: string): void {
  for (const [, pending] of record.pendingRpcCalls) {
    pending.reject(new Error(reason));
  }
  record.pendingRpcCalls.clear();
}

function removeWorkerSurfaces(record: WorkerPluginRecord): void {
  for (const routeSegment of record.routeSegments) {
    const current = hostState.mcpSurfaces.get(routeSegment);
    if (current?.ownerPluginID === record.manifest.id) {
      hostState.mcpSurfaces.delete(routeSegment);
    }
  }
  record.routeSegments.clear();
}

function resetWorkerSubscriptions(record: WorkerPluginRecord): void {
  record.subscriptions.runtime_connect = false;
  record.subscriptions.runtime_disconnect = false;
  record.subscriptions.ws_event = false;
  record.sessionStatusSubscriptions.clear();
}

function detachWorkerListeners(record: WorkerPluginRecord): void {
  record.worker.off("message", record.messageHandler);
  record.worker.off("error", record.errorHandler);
  record.worker.off("exit", record.exitHandler);
}

function teardownWorkerRecord(record: WorkerPluginRecord, reason: string): void {
  if (record.active) record.active = false;
  removeWorkerSurfaces(record);
  resetWorkerSubscriptions(record);
  rejectPendingWorkerCalls(record, reason);
  const deactivation = record.deactivation;
  record.deactivation = null;
  if (deactivation) {
    deactivation.resolve();
  }
}

async function terminateWorker(record: WorkerPluginRecord): Promise<void> {
  try {
    await record.worker.terminate();
  } catch {
  }
}

async function callWorkerRpc(
  record: WorkerPluginRecord,
  routeSegment: string,
  body: unknown,
  request: NextRequest,
): Promise<Response> {
  if (!record.active || record.unloading) {
    throw new Error(`plugin is unavailable: ${record.manifest.id}`);
  }

  record.nextRpcID += 1;
  const rpcID = record.nextRpcID;

  return new Promise<Response>((resolve, reject) => {
    record.pendingRpcCalls.set(rpcID, { resolve, reject });
    record.worker.postMessage({
      type: "rpc_call",
      rpcID,
      routeSegment,
      body,
      request: snapshotRequest(request),
    });
  });
}

async function dispatchHook<T>(
  store: Map<string, HookRecord<(event: T) => void | Promise<void>>>,
  payload: T,
): Promise<void> {
  const listeners = [...store.values()];
  for (const item of listeners) {
    try {
      await item.callback(payload);
    } catch (error) {
      pluginLog(
        item.ownerPluginID,
        "error",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

function emitWorkerEvent(record: WorkerPluginRecord, hook: WorkerHookName, payload: unknown): void {
  if (!record.active || record.unloading) return;
  if (hook !== "session_status_change" && !record.subscriptions[hook]) return;
  record.worker.postMessage({
    type: "event",
    hook,
    payload,
  });
}

function replyToWorker(
  record: WorkerPluginRecord,
  requestID: number,
  ok: boolean,
  result?: unknown,
  error?: string,
): void {
  record.worker.postMessage({
    type: "host_reply",
    requestID,
    ok,
    ...(typeof result === "undefined" ? {} : { result }),
    ...(error ? { error } : {}),
  } satisfies WorkerHostReplyMessage);
}

async function handleWorkerHostRequest(record: WorkerPluginRecord, message: WorkerHostRequestMessage): Promise<void> {
  try {
    if (message.action === "register_surface") {
      if (record.unloading) {
        throw new Error(`plugin is unloading: ${record.manifest.id}`);
      }

      const surfaceID = typeof message.payload.id === "string" && message.payload.id.trim()
        ? message.payload.id.trim()
        : `${record.manifest.id}.surface.${record.routeSegments.size + 1}`;
      const routeSegment = typeof message.payload.routeSegment === "string" ? message.payload.routeSegment.trim() : "";
      if (!routeSegment) {
        throw new Error("worker surface routeSegment is required");
      }

      const infoValue = message.payload.info;
      if (!infoValue || typeof infoValue !== "object") {
        throw new Error(`worker surface info is required: ${routeSegment}`);
      }

      const current = hostState.mcpSurfaces.get(routeSegment);
      if (current && current.ownerPluginID !== record.manifest.id) {
        throw new Error(`mcp routeSegment already registered: ${routeSegment}`);
      }
      if (current && current.ownerPluginID === record.manifest.id) {
        throw new Error(`worker surface already registered: ${routeSegment}`);
      }

      const surface = createProxySurface(
        record.manifest.id,
        record,
        surfaceID,
        routeSegment,
        infoValue as McpPluginInfo,
      );

      hostState.mcpSurfaces.set(routeSegment, {
        ownerPluginID: record.manifest.id,
        surface,
      });
      record.routeSegments.add(routeSegment);
      replyToWorker(record, message.requestID, true);
      return;
    }

    if (message.action === "subscribe_hook" || message.action === "unsubscribe_hook") {
      const hook = normalizeWorkerHookName(message.payload.hook);
      if (hook === "session_status_change") {
        const subscriptionID = typeof message.payload.subscriptionID === "string" ? message.payload.subscriptionID.trim() : "";
        if (!subscriptionID) {
          throw new Error("session_status_change subscriptionID is required");
        }
        if (message.action === "unsubscribe_hook") {
          record.sessionStatusSubscriptions.delete(subscriptionID);
        } else {
          const target = normalizeSessionStatusHookTarget({
            runtimeID: typeof message.payload.runtimeID === "string"
              ? message.payload.runtimeID
              : typeof (message.payload.target as Record<string, unknown> | undefined)?.runtimeID === "string"
                ? (message.payload.target as Record<string, unknown>).runtimeID as string
                : "",
            sessionID: typeof message.payload.sessionID === "string"
              ? message.payload.sessionID
              : typeof (message.payload.target as Record<string, unknown> | undefined)?.sessionID === "string"
                ? (message.payload.target as Record<string, unknown>).sessionID as string
                : "",
          });
          const optionsValue = message.payload.options && typeof message.payload.options === "object"
            ? (message.payload.options as SessionStatusWatchOptions)
            : {};
          const subscription: WorkerSessionStatusSubscription = {
            subscriptionID,
            target,
            targetKey: sessionStatusTargetKey(target),
            options: normalizeSessionStatusWatchOptions(optionsValue),
          };
          record.sessionStatusSubscriptions.set(subscriptionID, subscription);
          await emitCurrentSessionStatusToWorkerSubscription(record, subscription);
        }
      } else {
        record.subscriptions[hook] = message.action === "subscribe_hook";
      }
      replyToWorker(record, message.requestID, true);
      return;
    }

    if (message.action === "storage_get") {
      const key = typeof message.payload.key === "string" ? message.payload.key : "";
      const result = await createStorageApi(record.manifest.id).get(key);
      replyToWorker(record, message.requestID, true, result);
      return;
    }

    if (message.action === "storage_set") {
      const key = typeof message.payload.key === "string" ? message.payload.key : "";
      const result = await createStorageApi(record.manifest.id).set(key, message.payload.value);
      replyToWorker(record, message.requestID, true, result);
      return;
    }

    if (message.action === "storage_delete") {
      const key = typeof message.payload.key === "string" ? message.payload.key : "";
      const result = await createStorageApi(record.manifest.id).delete(key);
      replyToWorker(record, message.requestID, true, result);
      return;
    }

    if (message.action === "storage_list") {
      const prefix = typeof message.payload.prefix === "string" ? message.payload.prefix : "";
      const result = await createStorageApi(record.manifest.id).list(prefix);
      replyToWorker(record, message.requestID, true, result);
      return;
    }

    if (message.action === "osg_list_runtime_clients") {
      replyToWorker(record, message.requestID, true, await listPluginRuntimeClients());
      return;
    }

    if (message.action === "osg_require_online_runtime") {
      const runtimeID = typeof message.payload.runtimeID === "string" ? message.payload.runtimeID : "";
      await requireOnlineRuntime(runtimeID);
      replyToWorker(record, message.requestID, true);
      return;
    }

    if (message.action === "osg_list_runtime_managed_sessions") {
      const runtimeID = typeof message.payload.runtimeID === "string" ? message.payload.runtimeID : "";
      replyToWorker(record, message.requestID, true, await listRuntimeManagedSessions(runtimeID));
      return;
    }

    if (message.action === "osg_list_runtime_instance_workspaces") {
      const runtimeID = typeof message.payload.runtimeID === "string" ? message.payload.runtimeID : "";
      replyToWorker(record, message.requestID, true, await listPluginRuntimeInstanceWorkspaces(runtimeID));
      return;
    }

    if (message.action === "osg_request_runtime") {
      const runtimeID = typeof message.payload.runtimeID === "string" ? message.payload.runtimeID : "";
      const sessionID = typeof message.payload.sessionID === "string" ? message.payload.sessionID : "";
      replyToWorker(
        record,
        message.requestID,
        true,
        await requestRuntimeViaRuntime({ runtimeID, sessionID }),
      );
      return;
    }

    if (message.action === "osg_request_session_list") {
      const runtimeID = typeof message.payload.runtimeID === "string" ? message.payload.runtimeID : "";
      const list = Number(message.payload.list);
      const regex = typeof message.payload.regex === "string" ? message.payload.regex : undefined;
      replyToWorker(
        record,
        message.requestID,
        true,
        await requestSessionListViaRuntime({
          runtimeID,
          list: Number.isInteger(list) && list > 0 ? list : undefined,
          regex,
        }),
      );
      return;
    }

    if (message.action === "osg_create_new_session") {
      const runtimeID = typeof message.payload.runtimeID === "string" ? message.payload.runtimeID : "";
      const instanceWorkspaceDirectory = typeof message.payload.instanceWorkspaceDirectory === "string"
        ? message.payload.instanceWorkspaceDirectory
        : "";
      const content = typeof message.payload.content === "string" ? message.payload.content : "";
      const title = typeof message.payload.title === "string" ? message.payload.title : undefined;
      const model = typeof message.payload.model === "string" ? message.payload.model : undefined;
      const displayID = typeof message.payload.displayID === "string" ? message.payload.displayID : undefined;
      replyToWorker(
        record,
        message.requestID,
        true,
        await requestCreateNewSessionViaRuntime({ runtimeID, instanceWorkspaceDirectory, content, title, model, displayID }),
      );
      return;
    }

    if (message.action === "osg_rename_client_session") {
      const runtimeID = typeof message.payload.runtimeID === "string" ? message.payload.runtimeID : "";
      const sessionID = typeof message.payload.sessionID === "string" ? message.payload.sessionID : "";
      const title = typeof message.payload.title === "string" ? message.payload.title : "";
      replyToWorker(
        record,
        message.requestID,
        true,
        await requestRenameClientSessionViaRuntime({ runtimeID, sessionID, title }),
      );
      return;
    }

    if (message.action === "osg_set_client_display_session") {
      const runtimeID = typeof message.payload.runtimeID === "string" ? message.payload.runtimeID : "";
      const displayID = typeof message.payload.displayID === "string" ? message.payload.displayID : "";
      const sessionID = typeof message.payload.sessionID === "string" ? message.payload.sessionID : "";
      replyToWorker(
        record,
        message.requestID,
        true,
        await requestSetClientDisplaySessionViaRuntime({ runtimeID, displayID, sessionID }),
      );
      return;
    }

    if (message.action === "osg_abort_client_session") {
      const runtimeID = typeof message.payload.runtimeID === "string" ? message.payload.runtimeID : "";
      const sessionID = typeof message.payload.sessionID === "string" ? message.payload.sessionID : "";
      replyToWorker(
        record,
        message.requestID,
        true,
        await requestAbortClientSessionViaRuntime({ runtimeID, sessionID }),
      );
      return;
    }

    if (message.action === "osg_list_available_models") {
      const runtimeID = typeof message.payload.runtimeID === "string" ? message.payload.runtimeID : "";
      const list = Number(message.payload.list);
      const regex = typeof message.payload.regex === "string" ? message.payload.regex : undefined;
      replyToWorker(
        record,
        message.requestID,
        true,
        await requestListAvailableModelsViaRuntime({
          runtimeID,
          list: Number.isInteger(list) && list > 0 ? list : undefined,
          regex,
        }),
      );
      return;
    }

    if (message.action === "osg_get_session_last_used_model") {
      const runtimeID = typeof message.payload.runtimeID === "string" ? message.payload.runtimeID : "";
      const sessionID = typeof message.payload.sessionID === "string" ? message.payload.sessionID : "";
      replyToWorker(
        record,
        message.requestID,
        true,
        await requestLastUsedModelViaRuntime({ runtimeID, sessionID }),
      );
      return;
    }

    if (message.action === "osg_reload_client_instance_workspace") {
      const runtimeID = typeof message.payload.runtimeID === "string" ? message.payload.runtimeID : "";
      const instanceWorkspaceDirectory = typeof message.payload.instanceWorkspaceDirectory === "string"
        ? message.payload.instanceWorkspaceDirectory
        : undefined;
      const title = typeof message.payload.title === "string" ? message.payload.title : undefined;
      replyToWorker(
        record,
        message.requestID,
        true,
        await requestInstanceWorkspaceReloadViaRuntime({ runtimeID, instanceWorkspaceDirectory, title }),
      );
      return;
    }

    if (message.action === "osg_list_runtime_permissions") {
      const runtimeID = typeof message.payload.runtimeID === "string" ? message.payload.runtimeID : "";
      const sessionID = typeof message.payload.sessionID === "string" ? message.payload.sessionID : undefined;
      const status = typeof message.payload.status === "string" ? message.payload.status as PluginPermissionStatus : undefined;
      const list = Number(message.payload.list);
      replyToWorker(
        record,
        message.requestID,
        true,
        await listPluginRuntimePermissions({
          runtimeID,
          sessionID,
          status,
          list: Number.isInteger(list) && list > 0 ? list : undefined,
        }),
      );
      return;
    }

    if (message.action === "osg_get_runtime_permission") {
      const runtimeID = typeof message.payload.runtimeID === "string" ? message.payload.runtimeID : "";
      const permissionID = typeof message.payload.permissionID === "string" ? message.payload.permissionID : "";
      replyToWorker(
        record,
        message.requestID,
        true,
        await getPluginRuntimePermission({ runtimeID, permissionID }),
      );
      return;
    }

    if (message.action === "osg_resolve_runtime_permission") {
      const runtimeID = typeof message.payload.runtimeID === "string" ? message.payload.runtimeID : "";
      const permissionID = typeof message.payload.permissionID === "string" ? message.payload.permissionID : "";
      const action =
        message.payload.action === "approve" || message.payload.action === "deny" || message.payload.action === "cancel"
          ? message.payload.action
          : "cancel";
      const reason = typeof message.payload.reason === "string" ? message.payload.reason : undefined;
      const actor = typeof message.payload.actor === "string" ? message.payload.actor : undefined;
      const correlationID = typeof message.payload.correlationID === "string" ? message.payload.correlationID : undefined;
      replyToWorker(
        record,
        message.requestID,
        true,
        await requestResolvePermissionViaRuntime({ runtimeID, permissionID, action, reason, actor, correlationID }),
      );
      return;
    }

    if (message.action === "osg_has_online_runtime") {
      const runtimeID = typeof message.payload.runtimeID === "string" ? message.payload.runtimeID : "";
      replyToWorker(record, message.requestID, true, await hasOnlineRuntime(runtimeID));
      return;
    }

    if (message.action === "osg_has_online_runtime_session") {
      const runtimeID = typeof message.payload.runtimeID === "string" ? message.payload.runtimeID : "";
      const sessionID = typeof message.payload.sessionID === "string" ? message.payload.sessionID : "";
      replyToWorker(record, message.requestID, true, await hasOnlineRuntimeSession(runtimeID, sessionID));
      return;
    }

    if (message.action === "osg_require_online_runtime_session") {
      const runtimeID = typeof message.payload.runtimeID === "string" ? message.payload.runtimeID : "";
      const sessionID = typeof message.payload.sessionID === "string" ? message.payload.sessionID : "";
      await requireOnlineRuntimeSession(runtimeID, sessionID);
      replyToWorker(record, message.requestID, true);
      return;
    }

    if (message.action === "osg_add_prompt") {
      const runtimeID = typeof message.payload.runtimeID === "string" ? message.payload.runtimeID : "";
      const sessionID = typeof message.payload.sessionID === "string" ? message.payload.sessionID : "";
      const msg = typeof message.payload.msg === "string" ? message.payload.msg : "";
      const model = typeof message.payload.model === "string" ? message.payload.model : undefined;
      const system = typeof message.payload.system === "string" ? message.payload.system : undefined;
      replyToWorker(
        record,
        message.requestID,
        true,
        await requestAddPromptViaRuntime({ runtimeID, sessionID, msg, model, system }),
      );
      return;
    }

    if (message.action === "osg_get_session_messages") {
      const runtimeID = typeof message.payload.runtimeID === "string" ? message.payload.runtimeID : "";
      const sessionID = typeof message.payload.sessionID === "string" ? message.payload.sessionID : "";
      const size = Number(message.payload.size);
      const regex = typeof message.payload.regex === "string" ? message.payload.regex : undefined;
      replyToWorker(
        record,
        message.requestID,
        true,
        await requestSessionMessagesViaRuntime({
          runtimeID,
          sessionID,
          size: Number.isInteger(size) && size > 0 ? size : undefined,
          regex,
        }),
      );
      return;
    }

    if (message.action === "osg_show_toast") {
      const runtimeID = typeof message.payload.runtimeID === "string" ? message.payload.runtimeID : "";
      const displayID = typeof message.payload.displayID === "string" ? message.payload.displayID : "";
      const title = typeof message.payload.title === "string" ? message.payload.title : "";
      const toastMessage = typeof message.payload.message === "string" ? message.payload.message : "";
      const subtitle = typeof message.payload.subtitle === "string" ? message.payload.subtitle : undefined;
      const variant = message.payload.variant === "success" || message.payload.variant === "error" || message.payload.variant === "info"
        ? message.payload.variant
        : undefined;
      const durationMs = Number(message.payload.durationMs);
      await sendServerToastViaRuntime({
        runtimeID,
        displayID,
        title,
        message: toastMessage,
        subtitle,
        variant,
        durationMs: Number.isInteger(durationMs) && durationMs > 0 ? durationMs : undefined,
      });
      replyToWorker(record, message.requestID, true);
      return;
    }

    throw new Error(`unknown worker host action: ${message.action}`);
  } catch (error) {
    replyToWorker(
      record,
      message.requestID,
      false,
      undefined,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function handleUnexpectedWorkerShutdown(record: WorkerPluginRecord, reason: string): void {
  if (hostState.plugins.get(record.manifest.id) === record) {
    hostState.plugins.delete(record.manifest.id);
  }
  teardownWorkerRecord(record, reason);
  detachWorkerListeners(record);
  pluginLog(record.manifest.id, "warn", reason);
}

async function requestWorkerDeactivation(record: WorkerPluginRecord): Promise<void> {
  if (record.deactivation) {
    await record.deactivation.promise;
    return;
  }

  const deferred = createDeferred<void>();
  record.deactivation = deferred;
  record.worker.postMessage({ type: "deactivate" });

  await Promise.race([
    deferred.promise,
    new Promise<void>((resolve) => {
      setTimeout(resolve, 1500);
    }),
  ]);
}

function createWorkerRecord(
  manifest: OsgServerPluginManifest,
  source: Extract<PluginSource, { kind: "file" | "package" }>,
  worker: Worker,
): WorkerPluginRecord {
  return {
    kind: "worker",
    manifest,
    source,
    locked: false,
    loadedAt: new Date().toISOString(),
    active: false,
    worker,
    pendingRpcCalls: new Map<number, WorkerPendingRpc>(),
    nextRpcID: 0,
    routeSegments: new Set<string>(),
    subscriptions: {
      runtime_connect: false,
      runtime_disconnect: false,
      ws_event: false,
    },
    sessionStatusSubscriptions: new Map<string, WorkerSessionStatusSubscription>(),
    unloading: false,
    messageHandler: () => {},
    errorHandler: () => {},
    exitHandler: () => {},
    deactivation: null,
  };
}

async function waitForWorkerLoaded(worker: Worker, requestedPath: string): Promise<OsgServerPluginManifest> {
  return new Promise<OsgServerPluginManifest>((resolve, reject) => {
    const onMessage = (raw: unknown) => {
      const message = raw as Partial<WorkerIncomingMessage>;
      if (message.type === "loaded") {
        cleanup();
        try {
          resolve(normalizeManifest(message.manifest as OsgServerPluginManifest));
        } catch (error) {
          reject(error);
        }
        return;
      }
      if (message.type === "activation_failed") {
        cleanup();
        reject(new Error(String(message.error || `plugin worker failed before load handshake: ${requestedPath}`)));
        return;
      }
      if (message.type === "log") {
        const level = message.level === "warn" || message.level === "error" ? message.level : "info";
        pluginLog(`pending:${requestedPath}`, level, String(message.message || "worker log"), message.extra);
      }
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onExit = (code: number) => {
      cleanup();
      reject(new Error(`plugin worker exited before load handshake: ${requestedPath} (${code})`));
    };

    const cleanup = () => {
      worker.off("message", onMessage);
      worker.off("error", onError);
      worker.off("exit", onExit);
    };

    worker.on("message", onMessage);
    worker.once("error", onError);
    worker.once("exit", onExit);
  });
}

async function activateWorkerPlugin(source: Extract<PluginSource, { kind: "file" | "package" }>): Promise<PluginSummary> {
  const requestedSource = source.kind === "package" ? source.packageName : source.requestedPath;
  const worker = new Worker(pathToFileURL(workerRuntimePath()), {
    execArgv: ["--import", "tsx"],
    workerData: {
      requestedPath: requestedSource,
      absolutePath: source.absolutePath,
    },
  });

  const manifest = await waitForWorkerLoaded(worker, requestedSource);
  if (hostState.plugins.has(manifest.id)) {
    worker.postMessage({
      type: "activate_ack",
      ok: false,
      error: `plugin already loaded: ${manifest.id}`,
    });
    await terminateWorker(createWorkerRecord(manifest, source, worker));
    throw new Error(`plugin already loaded: ${manifest.id}`);
  }

  const activation = createDeferred<void>();
  const record = createWorkerRecord(manifest, source, worker);

  record.messageHandler = (raw: unknown) => {
    const message = raw as Partial<WorkerIncomingMessage>;
    if (message.type === "log") {
      const level = message.level === "warn" || message.level === "error" ? message.level : "info";
      pluginLog(record.manifest.id, level, String(message.message || "worker log"), message.extra);
      return;
    }

    if (message.type === "host_request") {
      void handleWorkerHostRequest(record, message as WorkerHostRequestMessage);
      return;
    }

    if (message.type === "rpc_result") {
      const pending = record.pendingRpcCalls.get(message.rpcID as number);
      if (!pending) return;
      record.pendingRpcCalls.delete(message.rpcID as number);
      pending.resolve(responseFromSnapshot((message as WorkerRpcResultMessage).response));
      return;
    }

    if (message.type === "rpc_error") {
      const pending = record.pendingRpcCalls.get(message.rpcID as number);
      if (!pending) return;
      record.pendingRpcCalls.delete(message.rpcID as number);
      pending.reject(new Error(String(message.error || "worker rpc failed")));
      return;
    }

    if (message.type === "activated") {
      record.active = true;
      activation.resolve();
      return;
    }

    if (message.type === "activation_failed") {
      activation.reject(new Error(String(message.error || "plugin activation failed")));
      return;
    }

    if (message.type === "deactivated") {
      const deferred = record.deactivation;
      record.deactivation = null;
      if (deferred) deferred.resolve();
    }
  };

  record.errorHandler = (error: Error) => {
    activation.reject(error);
    handleUnexpectedWorkerShutdown(record, error.message || "plugin worker crashed");
  };

  record.exitHandler = (code: number) => {
    if (record.unloading) {
      teardownWorkerRecord(record, `plugin unloaded: ${record.manifest.id}`);
      detachWorkerListeners(record);
      return;
    }

    activation.reject(new Error(`plugin worker exited unexpectedly: ${record.manifest.id} (${code})`));
    handleUnexpectedWorkerShutdown(record, `plugin worker exited unexpectedly: ${record.manifest.id} (${code})`);
  };

  worker.on("message", record.messageHandler);
  worker.on("error", record.errorHandler);
  worker.on("exit", record.exitHandler);

  hostState.plugins.set(manifest.id, record);
  worker.postMessage({ type: "activate_ack", ok: true });

  try {
    await activation.promise;
    pluginLog(manifest.id, "info", "loaded", { source: source.absolutePath, worker: true });
    return toPluginSummary(record);
  } catch (error) {
    hostState.plugins.delete(manifest.id);
    record.unloading = true;
    teardownWorkerRecord(record, `plugin activation failed: ${manifest.id}`);
    detachWorkerListeners(record);
    await terminateWorker(record);
    throw error;
  }
}

export function getAllowedPluginRoots(): string[] {
  return configuredPluginRoots();
}

export function listPluginSummaries(): PluginSummary[] {
  return [...hostState.plugins.values()]
    .map(toPluginSummary)
    .sort((a, b) => {
      if (a.locked !== b.locked) return a.locked ? -1 : 1;
      return a.id.localeCompare(b.id);
    });
}

export function listRegisteredMcpPlugins(): McpPlugin[] {
  return [...hostState.mcpSurfaces.values()]
    .map((entry) => entry.surface)
    .sort((a, b) => a.routeSegment.localeCompare(b.routeSegment));
}

export function getRegisteredMcpPlugin(routeSegment: string): McpPlugin | null {
  const clean = routeSegment.trim();
  if (!clean) return null;
  return hostState.mcpSurfaces.get(clean)?.surface ?? null;
}

export async function registerBuiltinPlugin(plugin: OsgServerPlugin): Promise<PluginSummary> {
  const manifest = normalizeManifest(plugin.manifest);
  const existing = hostState.plugins.get(manifest.id);
  if (existing) {
    return toPluginSummary(existing);
  }
  return activateInProcessPlugin(plugin, { kind: "builtin" }, true);
}

export async function loadPluginFromFile(requestedPath: string): Promise<PluginSummary> {
  const absolutePath = await resolvePluginEntry(requestedPath);
  return activateWorkerPlugin({ kind: "file", requestedPath, absolutePath, sourcePath: absolutePath });
}

export async function loadPluginFromPackage(packageName: string): Promise<PluginSummary> {
  const resolved = await resolveInstalledPluginEntry(packageName);
  return activateWorkerPlugin({
    kind: "package",
    packageName: resolved.packageName,
    packagePath: resolved.packagePath,
    absolutePath: resolved.absolutePath,
  });
}

export async function unloadPlugin(pluginID: string): Promise<PluginSummary> {
  const clean = pluginID.trim();
  if (!clean) throw new Error("pluginID is required");
  const record = hostState.plugins.get(clean);
  if (!record) throw new Error(`plugin not loaded: ${clean}`);
  if (record.locked) throw new Error(`plugin cannot be unloaded: ${clean}`);

  const summary = toPluginSummary(record);
  hostState.plugins.delete(clean);

  if (isWorkerRecord(record)) {
    record.unloading = true;
    record.active = false;
    removeWorkerSurfaces(record);
    rejectPendingWorkerCalls(record, `plugin unloaded: ${clean}`);
    resetWorkerSubscriptions(record);
    await requestWorkerDeactivation(record);
    detachWorkerListeners(record);
    await terminateWorker(record);
  } else {
    await disposeInProcessRecord(record);
  }

  pluginLog(clean, "info", "unloaded");
  return summary;
}

export async function reloadPlugin(pluginID: string): Promise<PluginSummary> {
  const clean = pluginID.trim();
  if (!clean) throw new Error("pluginID is required");
  const record = hostState.plugins.get(clean);
  if (!record) throw new Error(`plugin not loaded: ${clean}`);
  if (record.locked) throw new Error(`plugin cannot be reloaded: ${clean}`);
  if (record.source.kind === "builtin") throw new Error(`plugin has no reloadable source: ${clean}`);

  const source = record.source;
  await unloadPlugin(clean);
  if (source.kind === "package") {
    return loadPluginFromPackage(source.packageName);
  }
  return loadPluginFromFile(source.requestedPath);
}

export function emitRuntimeConnectEvent(event: RuntimeConnectEvent): void {
  void dispatchHook(hostState.runtimeConnectHooks, event);
  void refreshRuntimeSessionStatus(event.runtimeID, "runtime_connect");
  for (const record of hostState.plugins.values()) {
    if (isWorkerRecord(record)) {
      emitWorkerEvent(record, "runtime_connect", event);
    }
  }
}

export function emitRuntimeDisconnectEvent(event: RuntimeDisconnectEvent): void {
  void dispatchHook(hostState.runtimeDisconnectHooks, event);
  void refreshRuntimeSessionStatus(event.runtimeID, "runtime_disconnect");
  for (const record of hostState.plugins.values()) {
    if (isWorkerRecord(record)) {
      emitWorkerEvent(record, "runtime_disconnect", event);
    }
  }
}

export function emitRuntimeWsEvent(event: RuntimeWsEvent): void {
  void dispatchHook(hostState.wsEventHooks, event);
  for (const record of hostState.plugins.values()) {
    if (isWorkerRecord(record)) {
      emitWorkerEvent(record, "ws_event", event);
    }
  }
}

export function emitSessionStatusChangeForTarget(target: SessionStatusHookTarget): void {
  void refreshSessionStatusTarget(target, "client_content");
}
