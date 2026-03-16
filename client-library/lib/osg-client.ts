import { OSGLogger } from "./core/logger.js";
import { OSGWsClient } from "./core/ws-client.js";
import type { ToastHandler } from "./core/logger.js";

type OSGClientConfig = {
  wsServerUrl: string;
  runtimeID: string;
  hostName: string;
  logStream: { write: (line: string) => unknown };
  WebSocketImpl?: new (url: string) => any;
  reconnectMs?: number;
};

type OSGClientInf = {
  showToast?: ToastHandler;
  onOpen?: (message: any) => void;
  onMessage?: (raw: string, event: any, parsed: any) => void;
  onError?: (event: any) => void;
  onClose?: (event: any) => void;
  onServerEvent?: (message: any) => Promise<any> | any;
};

export class OSGClient {
  runtimeID: string;
  logger: OSGLogger;
  wsClient: OSGWsClient;
  start: () => void;
  stop: () => void;
  send: (payload: unknown) => boolean;

  constructor(config: OSGClientConfig, inf: OSGClientInf = {}) {
    const rawWsServerUrl = typeof config.wsServerUrl === "string" ? config.wsServerUrl.trim() : "";
    if (!rawWsServerUrl) {
      throw new Error("config.wsServerUrl is required and cannot be empty");
    }

    let parsed: URL;
    try {
      parsed = new URL(rawWsServerUrl);
    } catch {
      throw new Error("config.wsServerUrl is invalid");
    }

    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
      throw new Error("config.wsServerUrl protocol must be ws:// or wss://");
    }

    if (!config.logStream || typeof config.logStream.write !== "function") {
      throw new Error("config.logStream is required and must support write(line)");
    }

    if (!config.WebSocketImpl && typeof globalThis.WebSocket !== "function") {
      throw new Error("WebSocket implementation is required (config.WebSocketImpl)");
    }

    const runtimeID = typeof config.runtimeID === "string" ? config.runtimeID.trim() : "";
    if (!runtimeID) {
      throw new Error("config.runtimeID is required and cannot be empty");
    }

    const hostName = typeof config.hostName === "string" ? config.hostName.trim() : "";
    if (!hostName) {
      throw new Error("config.hostName is required and cannot be empty");
    }

    this.runtimeID = runtimeID;
    this.logger = new OSGLogger(config.logStream, inf.showToast);
    const wsUrl = new URL(rawWsServerUrl);
    wsUrl.searchParams.set("runtimeID", this.runtimeID);
    wsUrl.searchParams.set("host_name", hostName);
    this.wsClient = new OSGWsClient({
      url: wsUrl.toString(),
      displayUrl: rawWsServerUrl,
      runtimeID: this.runtimeID,
      WebSocketImpl: (config.WebSocketImpl || globalThis.WebSocket) as new (url: string) => any,
      reconnectMs: Number.isInteger(config.reconnectMs) ? config.reconnectMs : 5000,
      logger: this.logger,
      callbacks: inf,
    });

    this.start = this.wsClient.start.bind(this.wsClient);
    this.stop = this.wsClient.stop.bind(this.wsClient);
    this.send = this.wsClient.send.bind(this.wsClient);
  }
}
