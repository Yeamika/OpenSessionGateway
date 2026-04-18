import type { PluginContext, PluginOsgApi } from "@opensessiongateway/server-plugin-sdk";

export type RuntimeControlPermissionStatus =
  | "created"
  | "pending"
  | "approved"
  | "denied"
  | "cancelled"
  | "expired"
  | "superseded"
  | "failed";

export type RuntimeControlPermissionDecision = "approve" | "deny" | "cancel";

export type RuntimeControlPermission = {
  permissionID: string;
  runtimeID: string;
  sessionID: string | null;
  displayID: string | null;
  kind: string;
  title: string;
  description: string | null;
  detail: unknown;
  choices: Array<{ value: RuntimeControlPermissionDecision; label?: string }>;
  defaultAction: RuntimeControlPermissionDecision | null;
  status: RuntimeControlPermissionStatus;
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

export type RuntimeControlOsgApi = PluginOsgApi & {
  requestRuntime: (payload: {
    runtimeID: string;
    sessionID: string;
  }) => Promise<{
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
  }>;
  listRuntimeInstanceWorkspaces: (runtimeID: string) => Promise<Array<{
    runtimeID: string;
    instanceWorkspaceDirectory: string | null;
    title: string | null;
  }>>;
  reloadClientInstanceWorkspace: (payload: {
    runtimeID: string;
    instanceWorkspaceDirectory?: string;
    title?: string;
  }) => Promise<{ ok: boolean; instanceWorkspaceDirectory?: string; title?: string; reloaded?: boolean; error?: string }>;
  listRuntimePermissions: (payload: {
    runtimeID: string;
    sessionID?: string;
    status?: RuntimeControlPermissionStatus;
    list?: number;
  }) => Promise<{ realsize: number; list: RuntimeControlPermission[] }>;
  getRuntimePermission: (payload: {
    runtimeID: string;
    permissionID: string;
  }) => Promise<RuntimeControlPermission | null>;
  resolveRuntimePermission: (payload: {
    runtimeID: string;
    permissionID: string;
    action: RuntimeControlPermissionDecision;
    reason?: string;
    actor?: string;
    correlationID?: string;
  }) => Promise<{ ok: boolean; permissionID: string; action: RuntimeControlPermissionDecision; error?: string }>;
};

export type RuntimeControlServices = {
  osg: RuntimeControlOsgApi;
};

export function createRuntimeControlServices(context: PluginContext): RuntimeControlServices {
  return {
    osg: context.osg as RuntimeControlOsgApi,
  };
}
