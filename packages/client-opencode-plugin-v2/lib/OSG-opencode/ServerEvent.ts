import { handleListAvailableModels } from "./ws-event/ListAvailableModels.js";
import { handleListLastUsedModelOfSession } from "./ws-event/ListLastUsedModelOfSession.js";
import { handleGetSessionMsg } from "./ws-event/GetSessionMsg.js";
import { handleAbortSessionOfClient } from "./ws-event/AbortSessionOfClient.js";
import { handleRenameSessionOfClient } from "./ws-event/RenameSessionOfClient.js";
import { handleSetClientDisplaySession } from "./ws-event/SetClientDisplaySession.js";
import { handleAddPromot } from "./ws-event/AddPromot.js";
import { handleCreateNewSession } from "./ws-event/CreateNewSession.js";
import type { SessionListResponse } from "./ws-event/SessionList.js";
import { handleShowToast } from "./ws-event/ShowToast.js";
import { handleRequestInstanceWorkspaceReload } from "./ws-event/RequestInstanceWorkspaceReload.js";
import { buildPermissionResolvedPayload, handleResolvePermissionRequest } from "./ws-event/Permission.js";
import { handleRequestRuntime } from "./ws-event/RequestRuntime.js";
import {
  REQUEST_RUNTIME_EVENT,
  RESOLVE_PERMISSION_REQUEST_EVENT,
  readWsEnvelope,
} from "@opensessiongateway/protocol-library";

type QueryFactory = () => Record<string, unknown>;

type ServerEventDeps = {
  ctx: any;
  query: QueryFactory;
  runtimeID: string;
  GetCurrentClientInfo: () => Promise<Record<string, unknown>>;
  ListSession: (payload?: { list?: number; regex?: string }) => Promise<SessionListResponse>;
  RequestInstanceWorkspaceReload: (payload?: { instanceWorkspaceDirectory?: string; title?: string }) => Promise<unknown>;
  resolveInstanceWorkspaceInfo: () => { instanceWorkspaceDirectory: string; title: string } | null;
  resolvePermissionRoute: (permissionID: string) => { instanceWorkspaceDirectory: string; sessionID: string; displayID: string } | null;
  sendPermissionUpdated: (payload: Record<string, unknown>) => boolean;
  reportClientContentExecuteing: (payload: {
    displayID?: string;
    instanceWorkspaceDirectory?: string;
    session?: { sessionID?: string; title?: string; status?: "idle" | "busy" | "error" };
  }, force?: boolean) => boolean;
};

type RouteHandler = (payload: Record<string, unknown>, deps: ServerEventDeps) => Promise<unknown>;

function textSessionID(value: unknown): string | null {
  const src = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const sessionID = typeof src.sessionID === "string" ? src.sessionID.trim() : "";
  return sessionID || null;
}

function normalizeType(raw: unknown): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function handleServerEvent(message: unknown, deps: ServerEventDeps): Promise<unknown> {
  const envelope = readWsEnvelope(message);
  const type = normalizeType(envelope.type);
  const payload = envelope.data && typeof envelope.data === "object" ? (envelope.data as Record<string, unknown>) : {};

  const routeHandlers: Record<string, RouteHandler> = {
    listsession: async (routePayload) => deps.ListSession(routePayload as { list?: number; regex?: string }),
    renamesessionofclient: async (routePayload) => handleRenameSessionOfClient(deps.ctx, deps.query, routePayload),
    setclientdisplaysession: async (routePayload) => handleSetClientDisplaySession(deps.ctx, deps.query, routePayload),
    abortsessionofclient: async (routePayload) => handleAbortSessionOfClient(deps.ctx, deps.query, routePayload),
    listavailablemodels: async (routePayload) => handleListAvailableModels(deps.ctx, deps.query, routePayload),
    listlastusedmodelofsession: async (routePayload) => handleListLastUsedModelOfSession(deps.ctx, deps.query, deps.runtimeID, routePayload),
    getsessionmsg: async (routePayload) => handleGetSessionMsg(deps.ctx, deps.query, deps.runtimeID, routePayload),
    addpromot: async (routePayload) => handleAddPromot(deps.ctx, deps.query, deps.GetCurrentClientInfo, routePayload),
    createnewsession: async (routePayload) => handleCreateNewSession(deps.ctx, routePayload),
    servertoast: async (routePayload) => handleShowToast(deps.ctx, deps.query, routePayload),
    [normalizeType(RESOLVE_PERMISSION_REQUEST_EVENT)]: async (routePayload) => {
      const result = await handleResolvePermissionRequest(deps.ctx, routePayload, deps.resolvePermissionRoute);
      const src = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
      const permissionID = typeof src.permissionID === "string" ? src.permissionID : "";
      const action = src.action === "approve" || src.action === "deny" ? src.action : "cancel";
      const route = permissionID ? deps.resolvePermissionRoute(permissionID) : null;
      if (permissionID) {
        deps.sendPermissionUpdated(buildPermissionResolvedPayload({
          permissionID,
          sessionID: route?.sessionID || null,
          action,
          actor: typeof routePayload.actor === "string" ? routePayload.actor : null,
          reason: typeof routePayload.reason === "string" ? routePayload.reason : null,
          correlationID: typeof routePayload.correlationID === "string" ? routePayload.correlationID : null,
          ok: src.ok === true,
          error: typeof src.error === "string" ? src.error : null,
        }));
      }
      return result;
    },
    [normalizeType(REQUEST_RUNTIME_EVENT)]: async (routePayload) => handleRequestRuntime({
      ctx: deps.ctx,
      query: deps.query,
      runtimeID: deps.runtimeID,
      currentClientInfo: deps.GetCurrentClientInfo,
      listSession: deps.ListSession,
      reportClientContentExecuteing: deps.reportClientContentExecuteing,
      payload: routePayload,
    }),
    requestinstanceworkspacereload: async (routePayload) =>
      handleRequestInstanceWorkspaceReload(
        deps.ctx,
        deps.query,
        routePayload,
        deps.RequestInstanceWorkspaceReload,
      ),
  };

  const handler = routeHandlers[type];
  if (handler) {
    return handler(payload, deps);
  }

  return { accepted: true };
}
