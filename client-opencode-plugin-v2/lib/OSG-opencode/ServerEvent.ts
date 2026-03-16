import { handleListAvailableModels } from "./ws-event/ListAvailableModels.js";
import { handleListLastUsedModelOfSession } from "./ws-event/ListLastUsedModelOfSession.js";
import { handleGetSessionMsg } from "./ws-event/GetSessionMsg.js";
import { handleAbortSessionOfClient } from "./ws-event/AbortSessionOfClient.js";
import { handleRenameSessionOfClient } from "./ws-event/RenameSessionOfClient.js";
import { handleSelectSession } from "./ws-event/SelectSession.js";
import { handleAddPromot } from "./ws-event/AddPromot.js";
import { handleShowToast } from "./ws-event/ShowToast.js";

type QueryFactory = () => Record<string, unknown>;

type ServerEventDeps = {
  ctx: any;
  query: QueryFactory;
  runtimeID: string;
  GetCurrentClientInfo: () => Promise<unknown>;
  ListSession: (payload?: { list?: number; regex?: string; directory?: string }) => Promise<unknown>;
};

type RouteHandler = (payload: Record<string, unknown>, deps: ServerEventDeps) => Promise<unknown>;

function normalizeType(raw: unknown): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function handleServerEvent(message: unknown, deps: ServerEventDeps): Promise<unknown> {
  const src = message && typeof message === "object" ? (message as Record<string, unknown>) : {};
  const type = normalizeType(src.type);
  const payload = src.data && typeof src.data === "object" ? (src.data as Record<string, unknown>) : {};

  const routeHandlers: Record<string, RouteHandler> = {
    requestcurrentinfo: async () => deps.GetCurrentClientInfo(),
    listsession: async (routePayload) => deps.ListSession(routePayload as { list?: number; regex?: string; directory?: string }),
    renamesessionofclient: async (routePayload) => handleRenameSessionOfClient(deps.ctx, deps.query, routePayload),
    selectsession: async (routePayload) => handleSelectSession(deps.ctx, deps.query, routePayload),
    abortsessionofclient: async (routePayload) => handleAbortSessionOfClient(deps.ctx, deps.query, routePayload),
    listavailablemodels: async (routePayload) => handleListAvailableModels(deps.ctx, deps.query, routePayload),
    listlastusedmodelofsession: async (routePayload) => handleListLastUsedModelOfSession(deps.ctx, deps.query, deps.runtimeID, routePayload),
    getsessionmsg: async (routePayload) => handleGetSessionMsg(deps.ctx, deps.query, deps.runtimeID, routePayload),
    addpromot: async (routePayload) => handleAddPromot(deps.ctx, deps.query, deps.GetCurrentClientInfo, routePayload),
    servertoast: async (routePayload) => handleShowToast(deps.ctx, deps.query, routePayload),
  };

  const handler = routeHandlers[type];
  if (handler) {
    return handler(payload, deps);
  }

  return { accepted: true };
}
