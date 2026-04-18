import { handleServerEvent } from "./ws-event.js";
import {
  CONNECTED_EVENT,
  createBasicError,
  createWsEnvelope,
  createWsEventResponse,
  readConnectedEnvelope,
  readWsEnvelope,
  WS_EVENT_RESPONSE_TYPE,
} from "@opensessiongateway/protocol-library";
import type { OSGLogger } from "./logger.js";

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (reason?: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type WsEvent = { data?: unknown };

type WebSocketLike = {
  readyState: number;
  send: (data: string) => void;
  close: () => void;
  onopen: (() => void) | null;
  onmessage: ((event: WsEvent) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null;
};

type WebSocketCtor = new (url: string) => WebSocketLike;

type WsCallbacks = {
  onOpen?: (message: any) => void;
  onMessage?: (raw: string, event: WsEvent, parsed: any) => void;
  onError?: (event: unknown) => void;
  onClose?: (event: { code?: number; reason?: string }) => void;
  onServerEvent?: (message: any) => Promise<any> | any;
};

type Waiter = {
  resolve: (value: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type OSGWsClientOptions = {
  url: string;
  displayUrl: string;
  runtimeID: string;
  WebSocketImpl: WebSocketCtor;
  reconnectMs: number;
  logger: OSGLogger;
  callbacks?: WsCallbacks;
};

export class OSGWsClient {
  private readonly url: string;
  private readonly displayUrl: string;
  private readonly runtimeID: string;
  private readonly WebSocketImpl: WebSocketCtor;
  private readonly reconnectMs: number;
  private readonly logger: OSGLogger;
  private readonly callbacks: WsCallbacks;

  private ws: WebSocketLike | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = true;
  private connected = false;
  private lastServerReply = "";
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly waiters: Waiter[] = [];
  private sequence = 0;

  constructor(options: OSGWsClientOptions) {
    this.url = options.url;
    this.displayUrl = options.displayUrl;
    this.runtimeID = options.runtimeID;
    this.WebSocketImpl = options.WebSocketImpl;
    this.reconnectMs = options.reconnectMs;
    this.logger = options.logger;
    this.callbacks = options.callbacks || {};
  }

  startHeartbeatTest() {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      if (this.stopped || !this.connected) return;
      this.logger.info("heartbeat test", { runtimeID: this.runtimeID });
      this.logger.toast("info", `runtimeID=${this.runtimeID}`, "Heartbeat");
    }, 10000);
  }

  stopHeartbeatTest() {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  start() {
    this.stopped = false;
    this.connected = false;
    this.lastServerReply = "";
    this.connect();
  }

  waitConnected(timeoutMs = 5000) {
    if (this.connected) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        const index = this.waiters.findIndex((item) => item.timeout === timeout)
        if (index >= 0) this.waiters.splice(index, 1)
        resolve(false)
      }, timeoutMs)
      this.waiters.push({ resolve, timeout })
    })
  }

  stop() {
    this.stopped = true;
    this.stopHeartbeatTest();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
      }
      this.ws = null;
    }
    this.connected = false;
    this.lastServerReply = "";
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("connection_closed"));
    }
    this.pendingRequests.clear();
  }

  nextRequestID(): string {
    this.sequence += 1;
    return `req_${Date.now()}_${this.sequence}`;
  }

  sendRequest(type: string, data: unknown = null, timeoutMs = 20000) {
    const requestID = this.nextRequestID();
    const payload = createWsEnvelope({ type, requestID, data });
    return new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestID);
        reject(new Error("event_response_timeout"));
      }, timeoutMs);

      this.pendingRequests.set(requestID, { resolve, reject, timeout });
      const sent = this.send(payload);
      if (!sent) {
        clearTimeout(timeout);
        this.pendingRequests.delete(requestID);
        reject(new Error("socket_not_open"));
      }
    });
  }

  resolvePendingResponse(message: any): boolean {
    const requestID = typeof message?.requestID === "string" ? message.requestID.trim() : "";
    if (!requestID) return false;
    const pending = this.pendingRequests.get(requestID);
    if (!pending) return false;
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(requestID);
    pending.resolve(message);
    return true;
  }

  async handleServerRequest(message: any) {
    const requestID = typeof message?.requestID === "string" ? message.requestID.trim() : "";
    if (!requestID) {
      this.send(createBasicError({ code: "missing_requestID", message: "Server event must include requestID" }));
      return;
    }

    try {
      const result = await handleServerEvent(message, this.callbacks, this.runtimeID);
      this.send(createWsEventResponse({ requestID, ok: Boolean((result as any)?.ok), data: (result as any)?.data ?? null }));
    } catch (error) {
      this.send(
        createWsEventResponse({
          requestID,
          ok: false,
          data: {
            code: "client_event_error",
            message: error instanceof Error ? error.message : String(error),
          },
        }),
      );
    }
  }

  send(payload: unknown): boolean {
    if (!this.ws || this.ws.readyState !== 1) return false;
    try {
      const data = typeof payload === "string" ? payload : JSON.stringify(payload);
      this.ws.send(data);
      return true;
    } catch (error) {
      this.logger.error("ws send failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  scheduleReconnect() {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.connect();
    }, this.reconnectMs);
  }

  connect() {
    if (this.stopped) return;

    let ws: WebSocketLike;
    try {
      ws = new this.WebSocketImpl(this.url);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.lastServerReply = detail;
      this.logger.error("ws create failed", { message: detail });
      this.logger.toast("error", `${this.displayUrl} | ${detail}`, "OSG connect failed, retrying");
      this.scheduleReconnect();
      return;
    }

    this.ws = ws;
    ws.onopen = () => {
      this.logger.info("ws opened, waiting connected ack", {
        url: this.url,
        runtimeID: this.runtimeID,
      });
    };

    ws.onmessage = (event) => {
      const raw = this.readRaw(event.data)
      if (raw) this.lastServerReply = raw;
      this.logger.info("ws message", { raw });

      let parsed: any = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
      }

      if (parsed?.type === CONNECTED_EVENT) {
        this.handleConnectedAck(readConnectedEnvelope(parsed));
      }

      const envelope = readWsEnvelope(parsed);

      if (envelope.type === WS_EVENT_RESPONSE_TYPE) {
        this.resolvePendingResponse(parsed);
      } else if (envelope.type && envelope.requestID) {
        this.handleServerRequest(parsed).catch((error) => {
          this.logger.error("handle server request failed", {
            message: error instanceof Error ? error.message : String(error),
          });
        });
      }

      this.callbacks.onMessage?.(raw, event, parsed);
    };

    ws.onerror = (event) => {
      this.logger.error("ws error");
      this.callbacks.onError?.(event);
    };

    ws.onclose = (event) => {
      const wasConnected = this.connected;
      const detail = this.lastServerReply || event?.reason || `code=${event?.code ?? 0}`;
      this.logger.warn("ws closed", {
        code: event?.code,
        reason: event?.reason,
        detail,
      });
      if (!this.stopped) {
        this.logger.toast(
          wasConnected ? "warn" : "error",
          `${this.displayUrl} | ${detail}`,
          wasConnected ? "OSG disconnected, retrying" : "OSG connect failed, retrying",
        );
      }
      this.callbacks.onClose?.(event);
      this.connected = false;
      this.ws = null;
      for (const [, pending] of this.pendingRequests) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("connection_closed"));
      }
      this.pendingRequests.clear();
      this.scheduleReconnect();
    };
  }

  private readRaw(data: unknown): string {
    if (typeof data === "string") return data
    if (data instanceof Uint8Array) return Buffer.from(data).toString("utf8")
    if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8")
    if (data && typeof data === "object" && "toString" in data && typeof data.toString === "function") {
      const text = data.toString()
      return typeof text === "string" ? text : ""
    }
    return ""
  }

  handleConnectedAck(message: any): boolean {
    const runtimeID =
      message?.data && typeof message.data === "object" && typeof message.data.runtimeID === "string"
        ? message.data.runtimeID
        : "";
    if (!runtimeID) return false;
    if (runtimeID !== this.runtimeID) {
      this.logger.error("connected ack runtime mismatch", {
        expected: this.runtimeID,
        received: runtimeID,
      });
      return false;
    }
    if (this.connected) return true;

    this.connected = true;
    this.logger.info("ws connected ack", { runtimeID });
    this.logger.toast("success", `${this.displayUrl} | runtimeID=${runtimeID}`, "OSG connected");
    for (const item of this.waiters.splice(0)) {
      clearTimeout(item.timeout)
      item.resolve(true)
    }
    this.callbacks.onOpen?.(message);
    return true;
  }
}
