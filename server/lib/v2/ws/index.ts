import WebSocket from "ws";
import { processMailboxReminder } from "@/lib/ClientModel/mailbox/reminder";
import type { RuntimeClientView } from "@/lib/runtime-node";
import { getRuntimeBundle, removeRuntimeBundle, setRuntimeWsBridge, touchRuntimeWsBridge } from "@/lib/runtime-hub";

import { handleWsEvent } from "./ws-event";
import { createAbortSessionRequest } from "protocllibrary/ws-contract/AbortSessionOfClient.js";
import { createAddPromotRequest, readAddPromotResponse } from "protocllibrary/ws-contract/AddPromot.js";
import { createGetSessionMsgRequest, readGetSessionMsgResponse } from "protocllibrary/ws-contract/GetSessionMsg.js";
import { createListAvailableModelsRequest, readListAvailableModelsResponse } from "protocllibrary/ws-contract/ListAvailableModels.js";
import { readLastUsedModelResponse } from "protocllibrary/ws-contract/ListLastUsedModelOfSession.js";
import { createRenameSessionRequest } from "protocllibrary/ws-contract/RenameSessionOfClient.js";
import { createSelectSessionRequest } from "protocllibrary/ws-contract/SelectSession.js";
import { createShowToastPayload } from "protocllibrary/ws-contract/ShowToast.js";
import { createListSessionRequestPayload, readListSessionResponsePayload } from "protocllibrary/ws-contract/SessionList.js";

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
  requestCurrentInfoInFlight: boolean;
  requestSessionListInFlight: boolean;
  lastCurrentInfo: unknown;
  lastSessionList: Array<{ id: string; title?: string; status?: string; time?: string }>;
  connectedAt: string;
  lastActiveAt: string;
};

type V2GlobalState = {
  queues: Map<string, V2Queue>;
  pollerStarted: boolean;
};

const globalForV2 = globalThis as unknown as {
  __osgWsv2State?: V2GlobalState;
};

if (!globalForV2.__osgWsv2State) {
  globalForV2.__osgWsv2State = {
    queues: new Map<string, V2Queue>(),
    pollerStarted: false,
  };
}

const v2State = globalForV2.__osgWsv2State;
const v2Queues = v2State.queues;
const DEFAULT_EVENT_TIMEOUT_MS = 20000;
const REQUEST_CURRENT_INFO_INTERVAL_MS = 10000;
const REQUEST_CURRENT_INFO_TIMEOUT_MS = 9000;
function createQueue(runtimeID: string, hostName: string, ws: WebSocket): V2Queue {
  return {
    runtimeID,
    hostName,
    ws,
    sequence: 0,
    events: [],
    pendingResponses: new Map(),
    requestCurrentInfoInFlight: false,
    requestSessionListInFlight: false,
    lastCurrentInfo: null,
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
  safeSend(ws, {
    type: "event_response",
    requestID,
    ok,
    data: data || null,
  });
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

function cleanupQueue(runtimeID: string): void {
  const queue = v2Queues.get(runtimeID);
  if (!queue) return;

  for (const [, pending] of queue.pendingResponses) {
    clearTimeout(pending.timeout);
    pending.reject(new Error("connection_closed"));
  }
  queue.pendingResponses.clear();
  v2Queues.delete(runtimeID);
  removeRuntimeBundle(runtimeID);
}

function emitToQueue(runtimeID: string, eventType: string, data: unknown = null, timeoutMs = DEFAULT_EVENT_TIMEOUT_MS): Promise<unknown> {
  const queue = v2Queues.get(runtimeID);
  if (!queue) {
    return Promise.reject(new Error(`runtime_not_connected:${runtimeID}`));
  }

  const requestID = createRequestID(queue);
  const envelope = {
    type: eventType,
    requestID,
    data,
  };

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
    safeSend(queue.ws, {
      type: "error",
      code: "missing_requestID",
      message: "Every event must include requestID",
    });
    return;
  }

  if (message.type === "event_response") {
    const pending = queue.pendingResponses.get(requestID);
    if (!pending) return;
    clearTimeout(pending.timeout);
    queue.pendingResponses.delete(requestID);
    pending.resolve(message);
    return;
  }

  const eventType = typeof message.type === "string" ? message.type : "unknown";
  const data = message.data ?? null;

  rememberEvent(queue, {
    requestID,
    type: eventType,
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
  payload: { title: string; message: string; subtitle?: string; variant?: "info" | "success" | "error"; durationMs?: number },
): Promise<void> {
  await emitToQueue(runtimeID, "ServerToast", createShowToastPayload(payload), 8000);
}

export async function requestSessionList(
  runtimeID: string,
  directory?: string,
  list = 10,
  regex?: string,
): Promise<{ meta: { matched: number }; sessions: Array<{ id: string; title?: string; status?: string; time?: string }> }> {
  const queue = v2Queues.get(runtimeID);
  if (!queue) return { meta: { matched: 0 }, sessions: [] };
  const requestPayload = createListSessionRequestPayload({ list, regex, directory });

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
  directory?: string,
): Promise<{ ok: boolean; sessionID: string; title: string }> {
  const payload = createRenameSessionRequest({ sessionID, title, directory });
  const response = await emitToQueue(runtimeID, "RenameSessionOfClient", payload, 12000) as { data?: unknown };
  const data = response?.data && typeof response.data === "object" ? (response.data as Record<string, unknown>) : {};
  return {
    ok: data.ok === true,
    sessionID: typeof data.sessionID === "string" ? data.sessionID : payload.sessionID,
    title: typeof data.title === "string" ? data.title : payload.title,
  };
}

export async function requestSelectSession(
  runtimeID: string,
  sessionID: string,
  directory?: string,
): Promise<{ ok: boolean; sessionID: string }> {
  const payload = createSelectSessionRequest({ sessionID, directory });
  const response = await emitToQueue(runtimeID, "SelectSession", payload, 12000) as { data?: unknown };
  const data = response?.data && typeof response.data === "object" ? (response.data as Record<string, unknown>) : {};
  return {
    ok: data.ok === true,
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
  role: "user" | "system" | "tool" = "user",
): Promise<{ ok: boolean; role: "user" | "system" | "tool"; model: string | null; sessionID: string; error?: string }> {
  const payload = createAddPromotRequest({ sessionID, msg, model, role });
  const response = await emitToQueue(runtimeID, "AddPromot", payload, 12000) as { data?: unknown };
  return readAddPromotResponse(response?.data);
}

export function listV2RuntimeClientsView(): RuntimeClientView[] {
  const rows: RuntimeClientView[] = [];
  for (const queue of v2Queues.values()) {
    const info = queue.lastCurrentInfo && typeof queue.lastCurrentInfo === "object"
      ? (queue.lastCurrentInfo as Record<string, unknown>)
      : {};

    const sessionID = typeof info.sessionID === "string" && info.sessionID.trim() ? info.sessionID.trim() : null;
    const title = typeof info.sessionTitle === "string" && info.sessionTitle.trim() ? info.sessionTitle.trim() : null;
    const cwd = typeof info.cwd === "string" && info.cwd.trim() ? info.cwd.trim() : "unknown";
    const portVal = Number(info.port);
    const port = Number.isInteger(portVal) && portVal > 0 && portVal <= 65535 ? portVal : null;

    rows.push({
      runtimeID: queue.runtimeID,
      sessionID,
      port,
      runtimeHost: queue.hostName || null,
      runtimeProtocol: "ws",
      workspace: cwd,
      title,
      status: "online",
      lastHeartbeatAt: queue.lastActiveAt,
      updatedAt: queue.lastActiveAt,
    });
  }

  return rows.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function readV2RuntimeCurrentStatus(runtimeID: string): string | null {
  const clean = runtimeID.trim();
  if (!clean) return null;
  const queue = v2Queues.get(clean);
  if (!queue) return null;
  const info = queue.lastCurrentInfo && typeof queue.lastCurrentInfo === "object"
    ? (queue.lastCurrentInfo as Record<string, unknown>)
    : {};
  const value = typeof info.status === "string" ? info.status.trim() : "";
  return value || null;
}

function requestCurrentInfo(runtimeID: string): void {
  const queue = v2Queues.get(runtimeID);
  if (!queue) return;
  if (queue.requestCurrentInfoInFlight) return;

  queue.requestCurrentInfoInFlight = true;
  emitToQueue(runtimeID, "RequestCurrentInfo", null, REQUEST_CURRENT_INFO_TIMEOUT_MS)
    .then((response) => {
      const payload = response as { data?: unknown };
      queue.lastCurrentInfo = payload?.data ?? null;
    })
    .catch(() => {
    })
    .finally(() => {
      queue.requestCurrentInfoInFlight = false;
    });
}

async function tryMailboxReminder(runtimeID: string): Promise<void> {
  const bundle = getRuntimeBundle(runtimeID);
  if (!bundle) return;
  const queue = v2Queues.get(runtimeID);
  const info = queue?.lastCurrentInfo && typeof queue.lastCurrentInfo === "object"
    ? (queue.lastCurrentInfo as Record<string, unknown>)
    : {};
  const currentSessionID = typeof info.sessionID === "string" ? info.sessionID.trim() : "";

  await processMailboxReminder({
    bundle,
    currentSessionID,
    currentStatus: readV2RuntimeCurrentStatus(runtimeID),
    sendPrompt: async ({ runtimeID: targetRuntimeID, sessionID, prompt }) => {
      await requestAddPromot(targetRuntimeID, sessionID, prompt, undefined, "system");
    },
  });
}

if (!v2State.pollerStarted) {
  v2State.pollerStarted = true;
  setInterval(() => {
    for (const runtimeID of v2Queues.keys()) {
      requestCurrentInfo(runtimeID);
      void tryMailboxReminder(runtimeID).catch(() => {});
    }
  }, REQUEST_CURRENT_INFO_INTERVAL_MS);
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
    ws.send(JSON.stringify({ type: "error", code: "missing_runtimeID", message: "Missing runtimeID in websocket handshake" }));
    ws.close(1008, "Missing runtimeID");
    return;
  }

  if (!hostName) {
    ws.send(JSON.stringify({ type: "error", code: "missing_host_name", message: "Missing host_name in websocket handshake" }));
    ws.close(1008, "Missing host_name");
    return;
  }

  const existing = v2Queues.get(runtimeID);
  if (existing) {
    existing.ws.close(1000, "Replaced by new v2 connection");
    cleanupQueue(runtimeID);
  }

  const queue = createQueue(runtimeID, hostName, ws);
  v2Queues.set(runtimeID, queue);
  setRuntimeWsBridge(runtimeID, hostName);

  safeSend(ws, { type: "connected", runtimeID });
  requestCurrentInfo(runtimeID);

  ws.on("message", (raw) => {
    try {
      const text = typeof raw === "string" ? raw : raw.toString();
      const message = JSON.parse(text) as Record<string, unknown>;
      if (!message || typeof message !== "object") {
        safeSend(ws, { type: "error", code: "invalid_event", message: "Event payload must be a JSON object" });
        return;
      }
      handleIncomingEvent(queue, message).catch((error) => {
        safeSend(ws, {
          type: "error",
          code: "internal_error",
          message: error instanceof Error ? error.message : String(error),
        });
      });
    } catch {
      safeSend(ws, { type: "error", code: "invalid_json", message: "Invalid JSON payload" });
    }
  });

  ws.on("close", () => {
    cleanupQueue(runtimeID);
  });

  ws.on("error", (error) => {
    console.error("WebSocket v2 error:", error);
  });
}
