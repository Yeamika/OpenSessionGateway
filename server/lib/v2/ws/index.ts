import WebSocket from "ws";
import { upsertPermissionUpdated } from "@/lib/permission/registry";
import { markPermissionResolutionRequested } from "@/lib/permission/registry";
import { getRuntimeQuestion, upsertQuestionUpdated } from "@/lib/question/registry";
import {
  emitRuntimeConnectEvent,
  emitRuntimeDisconnectEvent,
  emitSessionStatusChangeForTarget,
  emitRuntimeWsEvent,
} from "@/lib/plugins/host";
import type { RuntimeClientView } from "@/lib/runtime/view";
import {
  getRuntimeBundle,
  listRuntimeBundles,
  markRuntimeBundleDisconnected,
  setRuntimeWsBridge,
  touchRuntimeWsBridge,
} from "@/lib/runtime-hub";

import { handleWsEvent } from "./ws-event";
import { createAbortSessionRequest } from "@opensessiongateway/protocol-library/ws-protocol/AbortSessionOfClient.js";
import { createAddPromotRequest, readAddPromotResponse } from "@opensessiongateway/protocol-library/ws-protocol/AddPromot.js";
import { COMPACT_SESSION_EVENT, createCompactSessionRequest, readCompactSessionResponse } from "@opensessiongateway/protocol-library/ws-protocol/CompactSession.js";
import { createNewSessionRequest, readCreateNewSessionResponse } from "@opensessiongateway/protocol-library/ws-protocol/CreateNewSession.js";
import { createGetSessionMsgRequest, readGetSessionMsgResponse } from "@opensessiongateway/protocol-library/ws-protocol/GetSessionMsg.js";
import { createListAvailableModelsRequest, readListAvailableModelsResponse } from "@opensessiongateway/protocol-library/ws-protocol/ListAvailableModels.js";
import { readLastUsedModelResponse } from "@opensessiongateway/protocol-library/ws-protocol/ListLastUsedModelOfSession.js";
import { createResolvePermissionRequestPayload } from "@opensessiongateway/protocol-library/ws-protocol/Permission.js";
import { createReplyQuestionRequestPayload } from "@opensessiongateway/protocol-library/ws-protocol/Question.js";
import { createRequestRuntimePayload, readRequestRuntimeResponsePayload, type RequestRuntimeResponsePayload } from "@opensessiongateway/protocol-library/ws-protocol/RequestRuntime.js";
import { createRenameSessionRequest } from "@opensessiongateway/protocol-library/ws-protocol/RenameSessionOfClient.js";
import { createSetClientDisplaySessionRequest } from "@opensessiongateway/protocol-library/ws-protocol/SetClientDisplaySession.js";
import { createShowToastPayload } from "@opensessiongateway/protocol-library/ws-protocol/ShowToast.js";
import { createListSessionRequestPayload, readListSessionResponsePayload } from "@opensessiongateway/protocol-library/ws-protocol/SessionList.js";
import {
  CLIENT_CONTENT_EXECUTEING_EVENT,
  createBasicError,
  createConnectedEnvelope,
  createWsEnvelope,
  createWsEventResponse,
  readClientContentExecuteingPayload,
  REQUEST_RUNTIME_EVENT,
  REPLY_QUESTION_REQUEST_EVENT,
  RESOLVE_PERMISSION_REQUEST_EVENT,
  legacySessionStatusFromState,
  readWsEnvelope,
  WS_EVENT_RESPONSE_TYPE,
} from "@opensessiongateway/protocol-library";

type PendingResponse = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: NodeJS.Timeout;
};

type QueueEvent = {
  type: string;
  requestID: string;
  data: unknown;
  sentAt?: string;
  receivedAt?: string;
};

type V2Queue = {
  runtimeID: string;
  hostName: string;
  ws: WebSocket;
  sequence: number;
  events: QueueEvent[];
  pendingResponses: Map<string, PendingResponse>;
  requestSessionListInFlight: boolean;
  lastClientContentExecuteing: unknown;
  lastSessionList: Array<{ id: string; title?: string; status?: string; time?: string }>;
  connectedAt: string;
  lastActiveAt: string;
};

type V2GlobalState = {
  queues: Map<string, V2Queue>;
};

const globalForV2 = globalThis as unknown as {
  __osgWsv2State?: V2GlobalState;
};

if (!globalForV2.__osgWsv2State) {
  globalForV2.__osgWsv2State = {
    queues: new Map<string, V2Queue>(),
  };
}

const v2State = globalForV2.__osgWsv2State;
const v2Queues = v2State.queues;
const DEFAULT_EVENT_TIMEOUT_MS = 20000;

function runtimeStatusRank(status: RuntimeClientView["status"]): number {
  if (status === "online") return 1;
  return 0;
}

function compareRuntimeClients(a: RuntimeClientView, b: RuntimeClientView): number {
  const status = runtimeStatusRank(b.status) - runtimeStatusRank(a.status);
  if (status !== 0) return status;
  if (a.activeCount !== b.activeCount) return b.activeCount - a.activeCount;
  const lastActive = (b.lastActiveTime || "").localeCompare(a.lastActiveTime || "");
  if (lastActive !== 0) return lastActive;
  const updated = b.updatedAt.localeCompare(a.updatedAt);
  if (updated !== 0) return updated;
  const runtime = a.runtimeID.localeCompare(b.runtimeID);
  if (runtime !== 0) return runtime;
  const instanceWorkspace = (a.instanceWorkspaceDirectory || "").localeCompare(b.instanceWorkspaceDirectory || "");
  if (instanceWorkspace !== 0) return instanceWorkspace;
  const display = (a.displayID || "").localeCompare(b.displayID || "");
  if (display !== 0) return display;
  const title = (a.title || "").localeCompare(b.title || "");
  if (title !== 0) return title;
  return (a.sessionID || "").localeCompare(b.sessionID || "");
}

function createQueue(runtimeID: string, hostName: string, ws: WebSocket): V2Queue {
  return {
    runtimeID,
    hostName,
    ws,
    sequence: 0,
    events: [],
    pendingResponses: new Map(),
    requestSessionListInFlight: false,
    lastClientContentExecuteing: null,
    lastSessionList: [],
    connectedAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
  };
}

function createRequestID(queue: V2Queue): string {
  queue.sequence += 1;
  return `req_${Date.now()}_${queue.sequence}`;
}

function safeSend(ws: WebSocket, payload: unknown): boolean {
  if (ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(payload));
  return true;
}

function replyEvent(ws: WebSocket, requestID: string, ok: boolean, data: unknown): void {
  safeSend(ws, createWsEventResponse({ requestID, ok, data: data || null }));
}

function replyEventError(ws: WebSocket, requestID: string, code: string, message: string): void {
  replyEvent(ws, requestID, false, { code, message });
}

function rememberEvent(queue: V2Queue, event: QueueEvent): void {
  queue.events.push(event);
  queue.lastActiveAt = new Date().toISOString();
  touchRuntimeWsBridge(queue.runtimeID);
  if (queue.events.length > 500) {
    queue.events.shift();
  }
}

function cleanupQueue(runtimeID: string, ws?: WebSocket): void {
  const queue = v2Queues.get(runtimeID);
  if (!queue) return;
  if (ws && queue.ws !== ws) return;

  for (const [, pending] of queue.pendingResponses) {
    clearTimeout(pending.timeout);
    pending.reject(new Error("connection_closed"));
  }
  queue.pendingResponses.clear();
  v2Queues.delete(runtimeID);
  markRuntimeBundleDisconnected(runtimeID, queue.lastActiveAt);
  emitRuntimeDisconnectEvent({
    runtimeID,
    hostName: queue.hostName,
    connectedAt: queue.connectedAt,
    lastActiveAt: queue.lastActiveAt,
  });
  console.warn(`[runtime disconnect] ${runtimeID} (${queue.hostName})`);
}

function emitToQueue(runtimeID: string, eventType: string, data: unknown = null, timeoutMs = DEFAULT_EVENT_TIMEOUT_MS): Promise<unknown> {
  const queue = v2Queues.get(runtimeID);
  if (!queue) {
    return Promise.reject(new Error(`runtime_not_connected:${runtimeID}`));
  }

  const requestID = createRequestID(queue);
  const envelope = createWsEnvelope({ type: eventType, requestID, data });

  rememberEvent(queue, { ...envelope, sentAt: new Date().toISOString() });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      queue.pendingResponses.delete(requestID);
      reject(new Error("event_response_timeout"));
    }, timeoutMs);

    queue.pendingResponses.set(requestID, {
      resolve,
      reject,
      timeout,
    });

    const sent = safeSend(queue.ws, envelope);
    if (!sent) {
      clearTimeout(timeout);
      queue.pendingResponses.delete(requestID);
      reject(new Error("socket_not_open"));
    }
  });
}

async function handleIncomingEvent(queue: V2Queue, message: Record<string, unknown>): Promise<void> {
  const requestID = typeof message.requestID === "string" ? message.requestID.trim() : "";
  if (!requestID) {
      safeSend(queue.ws, createBasicError({ code: "missing_requestID", message: "Every event must include requestID" }));
    return;
  }

  const envelope = readWsEnvelope(message);

  if (envelope.type === WS_EVENT_RESPONSE_TYPE) {
    const pending = queue.pendingResponses.get(envelope.requestID);
    if (!pending) return;
    clearTimeout(pending.timeout);
    queue.pendingResponses.delete(envelope.requestID);
    pending.resolve(message);
    return;
  }

  const eventType = envelope.type || "unknown";
  const data = envelope.data ?? null;

  rememberEvent(queue, {
    requestID,
    type: eventType,
    data,
    receivedAt: new Date().toISOString(),
  });

  emitRuntimeWsEvent({
    runtimeID: queue.runtimeID,
    hostName: queue.hostName,
    type: eventType,
    requestID,
    data,
    receivedAt: new Date().toISOString(),
  });

  try {
    const result = await handleWsEvent(
      queue,
      eventType,
      data && typeof data === "object" ? (data as Record<string, unknown>) : {},
      emitToQueue,
    );
    if (!result.ok) {
      replyEventError(queue.ws, requestID, "event_rejected", result.error || "event rejected");
      return;
    }
    if (eventType === CLIENT_CONTENT_EXECUTEING_EVENT) {
      const content = readClientContentExecuteingPayload((result as { data?: unknown }).data);
      queue.lastClientContentExecuteing = content;
      const sessionID = content.session?.sessionID?.trim() || "";
      if (sessionID) {
        emitSessionStatusChangeForTarget({ runtimeID: queue.runtimeID, sessionID });
      }
    }
    replyEvent(queue.ws, requestID, true, result);
  } catch (error) {
    replyEventError(
      queue.ws,
      requestID,
      "bridge_failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function enqueueEvent(runtimeID: string, eventType: string, data: unknown = null, timeoutMs = 20000): Promise<unknown> {
  return emitToQueue(runtimeID, eventType, data, timeoutMs);
}

export async function sendServerToast(
  runtimeID: string,
  payload: { displayID: string; title: string; message: string; subtitle?: string; variant?: "info" | "success" | "error"; durationMs?: number },
): Promise<void> {
  await emitToQueue(runtimeID, "ServerToast", createShowToastPayload(payload), 8000);
}

export async function requestSessionList(
  runtimeID: string,
  list = 10,
  regex?: string,
): Promise<{ meta: { matched: number }; sessions: Array<{ id: string; title?: string; status?: string; time?: string }> }> {
  const queue = v2Queues.get(runtimeID);
  if (!queue) return { meta: { matched: 0 }, sessions: [] };
  const requestPayload = createListSessionRequestPayload({ list, regex });

  if (queue.requestSessionListInFlight) {
    return { meta: { matched: queue.lastSessionList.length }, sessions: queue.lastSessionList };
  }

  queue.requestSessionListInFlight = true;
  try {
    const response = await emitToQueue(runtimeID, "ListSession", requestPayload, 12000) as { data?: unknown };
    const parsed = readListSessionResponsePayload(response?.data);
    queue.lastSessionList = parsed.sessions;
    return parsed;
  } catch {
    return { meta: { matched: queue.lastSessionList.length }, sessions: queue.lastSessionList };
  } finally {
    queue.requestSessionListInFlight = false;
  }
}

export async function requestRenameSessionOfClient(
  runtimeID: string,
  sessionID: string,
  title: string,
): Promise<{ ok: boolean; sessionID: string; title: string }> {
  const payload = createRenameSessionRequest({ sessionID, title });
  const response = await emitToQueue(runtimeID, "RenameSessionOfClient", payload, 12000) as { data?: unknown };
  const data = response?.data && typeof response.data === "object" ? (response.data as Record<string, unknown>) : {};
  return {
    ok: data.ok === true,
    sessionID: typeof data.sessionID === "string" ? data.sessionID : payload.sessionID,
    title: typeof data.title === "string" ? data.title : payload.title,
  };
}

export async function requestSetClientDisplaySession(
  runtimeID: string,
  displayID: string,
  sessionID: string,
): Promise<{ ok: boolean; displayID: string; sessionID: string }> {
  const payload = createSetClientDisplaySessionRequest({ displayID, sessionID });
  const response = await emitToQueue(runtimeID, "SetClientDisplaySession", payload, 12000) as { data?: unknown };
  const data = response?.data && typeof response.data === "object" ? (response.data as Record<string, unknown>) : {};
  return {
    ok: data.ok === true,
    displayID: typeof data.displayID === "string" ? data.displayID : payload.displayID,
    sessionID: typeof data.sessionID === "string" ? data.sessionID : payload.sessionID,
  };
}

export async function requestAbortSessionOfClient(
  runtimeID: string,
  sessionID: string,
): Promise<{ ok: boolean; aborted: boolean; sessionID: string }> {
  const payload = createAbortSessionRequest({ sessionID });
  const response = await emitToQueue(runtimeID, "AbortSessionOfClient", payload, 12000) as { data?: unknown };
  const data = response?.data && typeof response.data === "object" ? (response.data as Record<string, unknown>) : {};
  return {
    ok: data.ok === true,
    aborted: data.aborted === true,
    sessionID: typeof data.sessionID === "string" ? data.sessionID : payload.sessionID,
  };
}

export async function requestCompactSession(
  runtimeID: string,
  payload: { sessionID: string; model?: string; auto?: boolean },
): Promise<{ ok: boolean; sessionID: string; model?: string; auto?: boolean; error?: string }> {
  const req = createCompactSessionRequest(payload);
  const response = await emitToQueue(runtimeID, COMPACT_SESSION_EVENT, req, 90000) as { data?: unknown };
  return readCompactSessionResponse(response?.data);
}

export async function requestListAvailableModels(
  runtimeID: string,
  list = 10,
  regex?: string,
): Promise<{ realsize: number; list: Array<{ providerID: string; modelID: string; name: string; id: string }> }> {
  const payload = createListAvailableModelsRequest({ list, regex });
  const response = await emitToQueue(runtimeID, "ListAvailableModels", payload, 12000) as { data?: unknown };
  return readListAvailableModelsResponse(response?.data);
}

export async function requestLastUsedModelOfSession(
  runtimeID: string,
  sessionID: string,
): Promise<{ runtimeID: string; sessionID: string; providerID: string; modelID: string; id: string; time: string }> {
  const response = await emitToQueue(
    runtimeID,
    "ListLastUsedModelOfSession",
    { sessionID },
    12000,
  ) as { data?: unknown };
  return readLastUsedModelResponse(response?.data);
}

export async function requestGetSessionMsg(
  runtimeID: string,
  sessionID: string,
  size = 10,
  regex?: string,
): Promise<{ runtimeID: string; sessionID: string; realsize: number; list: Array<Record<string, unknown>>; status: string }> {
  const payload = createGetSessionMsgRequest({ sessionID, size, regex });
  const response = await emitToQueue(runtimeID, "GetSessionMsg", payload, 12000) as { data?: unknown };
  return readGetSessionMsgResponse(response?.data);
}

export async function requestAddPromot(
  runtimeID: string,
  sessionID: string,
  msg: string,
  model?: string,
  system?: string,
): Promise<{ ok: boolean; model: string | null; sessionID: string; error?: string }> {
  const payload = createAddPromotRequest({ sessionID, msg, model, system });
  const response = await emitToQueue(runtimeID, "AddPromot", payload, 12000) as { data?: unknown };
  return readAddPromotResponse(response?.data);
}

export async function requestResolvePermission(
  runtimeID: string,
  payload: { permissionID: string; sessionID?: string; action: "approve" | "deny" | "cancel"; reason?: string; actor?: string; correlationID?: string },
): Promise<{ ok: boolean; permissionID: string; action: "approve" | "deny" | "cancel"; error?: string }> {
  const current = markPermissionResolutionRequested(runtimeID, payload.permissionID);
  const req = createResolvePermissionRequestPayload({
    ...payload,
    sessionID: payload.sessionID || current?.sessionID || null,
  });
  const response = await emitToQueue(runtimeID, RESOLVE_PERMISSION_REQUEST_EVENT, req, 12000) as { data?: unknown };
  const data = response?.data && typeof response.data === "object" ? (response.data as Record<string, unknown>) : {};
  const result = {
    ok: data.ok === true,
    permissionID: typeof data.permissionID === "string" ? data.permissionID : req.permissionID,
    action: data.action === "approve" || data.action === "deny" ? data.action : req.action,
    error: typeof data.error === "string" ? data.error : undefined,
  };
  upsertPermissionUpdated(runtimeID, {
    permissionID: result.permissionID,
    sessionID: req.sessionID,
    status: result.ok
      ? result.action === "approve"
        ? "approved"
        : result.action === "deny"
          ? "denied"
          : "cancelled"
      : "failed",
    updatedAt: new Date().toISOString(),
    actor: req.actor,
    reason: req.reason,
    message: result.error || null,
    supersededByPermissionID: null,
    correlationID: req.correlationID,
  });
  return result;
}

export async function requestReplyQuestion(
  runtimeID: string,
  payload: { questionID: string; replyType: "answer" | "reject"; answers?: string[][] | null; reason?: string; actor?: string; correlationID?: string },
): Promise<{ ok: boolean; questionID: string; replyType: "answer" | "reject"; error?: string }> {
  const current = getRuntimeQuestion(runtimeID, payload.questionID);
  const req = createReplyQuestionRequestPayload({
    ...payload,
    sessionID: current?.sessionID || null,
  });
  const response = await emitToQueue(runtimeID, REPLY_QUESTION_REQUEST_EVENT, req, 12000) as { data?: unknown };
  const data = response?.data && typeof response.data === "object" ? (response.data as Record<string, unknown>) : {};
  const result = {
    ok: data.ok === true,
    questionID: typeof data.questionID === "string" ? data.questionID : req.questionID,
    replyType: data.replyType === "reject" ? "reject" : req.replyType,
    error: typeof data.error === "string" ? data.error : undefined,
  } as const;
  upsertQuestionUpdated(runtimeID, {
    questionID: result.questionID,
    sessionID: current?.sessionID || null,
    status: result.ok
      ? result.replyType === "reject"
        ? "rejected"
        : "answered"
      : "failed",
    updatedAt: new Date().toISOString(),
    answers: req.answers,
    actor: req.actor,
    reason: req.reason,
    message: result.error || null,
    correlationID: req.correlationID,
  });
  return result;
}

export async function requestRuntime(
  runtimeID: string,
  payload: { sessionID: string },
): Promise<RequestRuntimeResponsePayload> {
  const req = createRequestRuntimePayload(payload);
  const response = await emitToQueue(runtimeID, REQUEST_RUNTIME_EVENT, req, 12000) as { data?: unknown };
  return readRequestRuntimeResponsePayload(response?.data);
}

export async function requestCreateNewSession(
  runtimeID: string,
  payload: { instanceWorkspaceDirectory: string; content: string; title?: string; model?: string; displayID?: string },
) {
  const req = createNewSessionRequest(payload)
  const response = await emitToQueue(runtimeID, "CreateNewSession", req, 12000) as { data?: unknown }
  return readCreateNewSessionResponse(response?.data)
}

export async function requestInstanceWorkspaceReload(
  runtimeID: string,
  payload?: { instanceWorkspaceDirectory?: string; title?: string },
): Promise<{ ok: boolean; instanceWorkspaceDirectory?: string; title?: string; reloaded?: boolean; error?: string }> {
  const response = await emitToQueue(runtimeID, "RequestInstanceWorkspaceReload", payload ? {
    instanceWorkspaceDirectory: payload.instanceWorkspaceDirectory,
    title: payload.title,
  } : null, 12000) as { data?: unknown };
  const data = response?.data && typeof response.data === "object" ? (response.data as Record<string, unknown>) : {};
  return {
    ok: data.ok === true,
    instanceWorkspaceDirectory: typeof data.instanceWorkspaceDirectory === "string" ? data.instanceWorkspaceDirectory : undefined,
    title: typeof data.title === "string" ? data.title : undefined,
    reloaded: data.reloaded === true,
    error: typeof data.error === "string" ? data.error : undefined,
  };
}

export function listV2RuntimeClientsView(): RuntimeClientView[] {
  const rows: RuntimeClientView[] = [];
  const activeRuntimeIDs = new Set<string>();
  for (const queue of v2Queues.values()) {
    activeRuntimeIDs.add(queue.runtimeID);
    const content = readClientContentExecuteingPayload(queue.lastClientContentExecuteing);
    const runtime = getRuntimeBundle(queue.runtimeID)
    const sessions = runtime?.sessions || []
    const base = {
      runtimeID: queue.runtimeID,
      port: null,
      runtimeHost: queue.hostName || null,
      runtimeProtocol: "ws" as const,
      status: "online" as const,
      lastActiveTime: queue.lastActiveAt,
      activeCount: 0,
      lastHeartbeatAt: queue.lastActiveAt,
      updatedAt: queue.lastActiveAt,
    }

    if (!sessions.length) {
      rows.push({
        ...base,
        sessionID: content.session?.sessionID || null,
        displayID: content.displayID || null,
        instanceWorkspaceDirectory: content.instanceWorkspaceDirectory || null,
        title: content.session?.title || null,
        sessionStatus: content.session?.status || legacySessionStatusFromState(content.session?.state) || null,
        sessionState: content.session?.state || null,
        sessionReason: content.session?.reason || null,
        sessionMeta: content.session?.meta || null,
      })
      continue
    }

    for (const item of sessions) {
      const instanceWorkspaceDirectory = content.instanceWorkspaceDirectory || null
      rows.push({
        ...base,
        sessionID: item.sessionID,
        displayID: item.displayID,
        instanceWorkspaceDirectory,
        title: item.title,
        sessionStatus: item.status,
        sessionState: item.state,
        sessionReason: item.reason,
        sessionMeta: item.meta,
        lastActiveTime: item.lastActiveTime,
        activeCount: item.activeCount,
        updatedAt: item.lastActiveTime || queue.lastActiveAt,
      })
    }
  }

  for (const runtime of listRuntimeBundles()) {
    if (activeRuntimeIDs.has(runtime.runtimeID)) continue;

    const updatedAt = runtime.wsBridge.lastSeenAt || runtime.wsBridge.connectedAt || new Date().toISOString();
    const base = {
      runtimeID: runtime.runtimeID,
      port: null,
      runtimeHost: runtime.wsBridge.hostName,
      runtimeProtocol: "ws" as const,
      status: "offline" as const,
      lastActiveTime: runtime.wsBridge.lastSeenAt,
      activeCount: 0,
      lastHeartbeatAt: runtime.wsBridge.lastSeenAt,
      updatedAt,
    }

    if (!runtime.sessions.length) {
      rows.push({
        ...base,
        sessionID: null,
        displayID: null,
        instanceWorkspaceDirectory: null,
        title: null,
        sessionStatus: null,
        sessionState: null,
        sessionReason: null,
        sessionMeta: null,
      })
      continue
    }

    for (const item of runtime.sessions) {
      rows.push({
        ...base,
        sessionID: item.sessionID,
        displayID: item.displayID,
        instanceWorkspaceDirectory: null,
        title: item.title,
        sessionStatus: item.status,
        sessionState: item.state,
        sessionReason: item.reason,
        sessionMeta: item.meta,
        lastActiveTime: item.lastActiveTime,
        activeCount: item.activeCount,
        updatedAt: item.lastActiveTime || updatedAt,
      })
    }
  }

  return rows.sort(compareRuntimeClients);
}

type UpgradeInput = {
  request: { url?: string | null };
  ws: WebSocket;
};

export function handleV2Upgrade({ request, ws }: UpgradeInput): void {
  const rawUrl = request.url || "";
  const urlParams = new URLSearchParams(rawUrl.split("?")[1] || "");
  const runtimeID = (urlParams.get("runtimeID") || "").trim();
  const hostName = (urlParams.get("host_name") || "").trim();

  if (!runtimeID) {
    ws.send(JSON.stringify(createBasicError({ code: "missing_runtimeID", message: "Missing runtimeID in websocket handshake" })));
    ws.close(1008, "Missing runtimeID");
    return;
  }

  if (!hostName) {
    ws.send(JSON.stringify(createBasicError({ code: "missing_host_name", message: "Missing host_name in websocket handshake" })));
    ws.close(1008, "Missing host_name");
    return;
  }

  const existing = v2Queues.get(runtimeID);
  if (existing) {
    const existingActive = existing.ws.readyState === WebSocket.OPEN || existing.ws.readyState === WebSocket.CONNECTING;
    if (existingActive) {
      console.warn(`[runtime reject duplicate] ${runtimeID} (${existing.hostName})`);
      ws.send(JSON.stringify(createBasicError({
        code: "duplicate_runtimeID",
        message: `runtimeID is already connected: ${runtimeID}`,
      })));
      ws.close(1008, "Duplicate runtimeID");
      return;
    }

    console.warn(`[runtime cleanup inactive] ${runtimeID} (${existing.hostName})`);
    cleanupQueue(runtimeID, existing.ws);
  }

  const queue = createQueue(runtimeID, hostName, ws);
  v2Queues.set(runtimeID, queue);
  setRuntimeWsBridge(runtimeID, hostName);
  emitRuntimeConnectEvent({
    runtimeID,
    hostName,
    connectedAt: queue.connectedAt,
  });
  console.log(`[runtime connect] ${runtimeID} (${hostName})`);

  safeSend(ws, createConnectedEnvelope({ runtimeID }));

  ws.on("message", (raw) => {
    try {
      const text = typeof raw === "string" ? raw : raw.toString();
      const message = JSON.parse(text) as Record<string, unknown>;
      if (!message || typeof message !== "object") {
        safeSend(ws, createBasicError({ code: "invalid_event", message: "Event payload must be a JSON object" }));
        return;
      }
      handleIncomingEvent(queue, message).catch((error) => {
        safeSend(ws, createBasicError({ code: "internal_error", message: error instanceof Error ? error.message : String(error) }));
      });
    } catch {
      safeSend(ws, createBasicError({ code: "invalid_json", message: "Invalid JSON payload" }));
    }
  });

  ws.on("close", () => {
    cleanupQueue(runtimeID, ws);
  });

  ws.on("error", (error) => {
    console.error(`[runtime error] ${runtimeID} (${hostName}) ${error instanceof Error ? error.message : String(error)}`);
    console.error("WebSocket v2 error:", error);
  });
}
