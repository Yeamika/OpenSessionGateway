export type PluginSource =
  | { kind: "builtin" }
  | { kind: "file"; requestedPath: string; absolutePath: string };

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
  sessionState: "idle" | "busy" | "waiting" | "stopped" | null;
  sessionReason:
    | "completed"
    | "pending"
    | "tool"
    | "generating"
    | "reasoning"
    | "compacting"
    | "permission"
    | "question"
    | "aborted"
    | "error"
    | null;
  sessionMeta: Record<string, unknown> | null;
  title: string | null;
  displayID: string | null;
  instanceWorkspaceDirectory: string | null;
  runtimeHost: string | null;
  lastActiveTime: string | null;
  updatedAt: string;
};

export type SessionStatusChangeField =
  | "runtimeStatus"
  | "sessionState"
  | "sessionReason"
  | "sessionMeta"
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

export type PluginRuntimeClient = {
  runtimeID: string;
  sessionID: string | null;
  displayID: string | null;
  port: number | null;
  runtimeHost: string | null;
  runtimeProtocol: string | null;
  instanceWorkspaceDirectory: string | null;
  title: string | null;
  status: "online" | "offline";
  sessionState: "idle" | "busy" | "waiting" | "stopped" | null;
  sessionReason:
    | "completed"
    | "pending"
    | "tool"
    | "generating"
    | "reasoning"
    | "compacting"
    | "permission"
    | "question"
    | "aborted"
    | "error"
    | null;
  sessionMeta: Record<string, unknown> | null;
  lastActiveTime: string | null;
  activeCount: number;
  lastHeartbeatAt: string | null;
  updatedAt: string;
};

export type PluginManagedSession = {
  sessionID: string;
  title: string | null;
  state: "idle" | "busy" | "waiting" | "stopped" | null;
  reason:
    | "completed"
    | "pending"
    | "tool"
    | "generating"
    | "reasoning"
    | "compacting"
    | "permission"
    | "question"
    | "aborted"
    | "error"
    | null;
  meta: Record<string, unknown> | null;
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
    state?: "idle" | "busy" | "waiting" | "stopped" | null;
    reason?: "completed" | "pending" | "tool" | "generating" | "reasoning" | "compacting" | "permission" | "question" | "aborted" | "error" | null;
    meta?: Record<string, unknown> | null;
    displayID?: string | null;
  };
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

export type PluginQuestionStatus = "created" | "pending" | "answered" | "rejected" | "failed";

export type PluginQuestionReplyType = "answer" | "reject";

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

export type PluginQuestionInfo = {
  header: string;
  question: string;
  options: Array<{ label: string; description?: string }>;
  multiple?: boolean;
  custom?: boolean;
};

export type PluginRuntimeQuestion = {
  questionID: string;
  runtimeID: string;
  sessionID: string | null;
  displayID: string | null;
  title: string;
  questions: PluginQuestionInfo[];
  detail: unknown;
  status: PluginQuestionStatus;
  requestedAt: string;
  updatedAt: string;
  answeredAt: string | null;
  answers: string[][] | null;
  actor: string | null;
  reason: string | null;
  message: string | null;
  correlationID: string | null;
  dedupeKey: string | null;
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
  compactSession: (payload: {
    runtimeID: string;
    sessionID: string;
    model: string;
    auto?: boolean;
  }) => Promise<{ ok: boolean; sessionID: string; model?: string; auto?: boolean; error?: string }>;
  listAvailableModels: (payload: {
    runtimeID: string;
    list?: number;
    regex?: string;
  }) => Promise<{ realsize: number; list: Array<{ providerID: string; modelID: string; name: string; id: string }> }>;
  getSessionLastUsedModel: (payload: {
    runtimeID: string;
    sessionID: string;
  }) => Promise<{ runtimeID: string; sessionID: string; providerID: string; modelID: string; id: string; time: string }>;
  hasOnlineRuntime: (runtimeID: string) => Promise<boolean>;
  hasOnlineRuntimeSession: (runtimeID: string, sessionID: string) => Promise<boolean>;
  requireOnlineRuntimeSession: (runtimeID: string, sessionID: string) => Promise<void>;
  addPrompt: (payload: {
    runtimeID: string;
    sessionID: string;
    // AddPromot / osg.addPrompt now always sends a user message.
    msg: string;
    model?: string;
    // Optional per-request system text for the same user turn.
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
  listRuntimeQuestions: (payload: {
    runtimeID: string;
    sessionID?: string;
    status?: PluginQuestionStatus;
    list?: number;
  }) => Promise<{ realsize: number; list: PluginRuntimeQuestion[] }>;
  getRuntimeQuestion: (payload: {
    runtimeID: string;
    questionID: string;
  }) => Promise<PluginRuntimeQuestion | null>;
  replyRuntimeQuestion: (payload: {
    runtimeID: string;
    questionID: string;
    replyType: PluginQuestionReplyType;
    answers?: string[][] | null;
    reason?: string;
    actor?: string;
    correlationID?: string;
  }) => Promise<{ ok: boolean; questionID: string; replyType: PluginQuestionReplyType; error?: string }>;
};

export type McpPluginInfo = {
  ok: boolean;
  endpoint: string;
  server: string;
  implemented: boolean;
  description?: string;
};

export type McpPlugin = {
  id: string;
  routeSegment: string;
  info: () => McpPluginInfo;
  handleRpc: (body: unknown, request: unknown) => Promise<Response>;
};

export type PluginContext = {
  pluginID: string;
  manifest: OsgServerPluginManifest;
  source: PluginSource;
  cleanup: (fn: () => void | Promise<void>) => void;
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
  activate: (context: PluginContext) => void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>;
};

export function parseRpc(body: unknown): {
  id: unknown;
  method: string;
  params: Record<string, unknown>;
} {
  const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  return {
    id: payload.id ?? null,
    method: typeof payload.method === "string" ? payload.method.trim() : "",
    params: payload.params && typeof payload.params === "object"
      ? (payload.params as Record<string, unknown>)
      : {},
  };
}

export function successResult(id: unknown, result: unknown) {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

export function errorResult(id: unknown, code: number, message: string) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  };
}

export function textResult(data: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}
