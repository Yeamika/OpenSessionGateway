import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";

import { OSGClient } from "@opensessiongateway/client-library";
import { buildOsgRuntimeConfig } from "../config.js";
import {
  applyEventToCurrentClientInfo,
  createInitialCurrentClientInfo,
  getCurrentClientInfoSnapshot,
  type CurrentClientInfo,
} from "./ws-event/CurrentClientInfo.js";
import { handleServerEvent } from "./ServerEvent.js";
import { readCurrentSessionList, type SessionListResponse } from "./ws-event/SessionList.js";

type WriteLog = (level: string, message: string, extra?: Record<string, unknown>) => Promise<void>;

export class OSGOpencodeClient {
  private readonly ctx: any;
  private readonly query: () => Record<string, unknown>;
  private osgClient: OSGClient | null;
  private logFileStream: fs.WriteStream | null;
  private runtimeIDForMcp: string;
  private wsServerUrlForMcp: string;
  private readonly currentClientInfo: CurrentClientInfo;
  readonly inf: {
    GetCurrentClientInfo: () => Promise<CurrentClientInfo>;
    ListSession: (payload?: { list?: number; regex?: string; directory?: string }) => Promise<SessionListResponse>;
  };
  writeLog: WriteLog;

  constructor(ctx: any, query: () => Record<string, unknown>) {
    this.ctx = ctx;
    this.query = query;
    this.osgClient = null;
    this.logFileStream = null;
    this.runtimeIDForMcp = "";
    this.wsServerUrlForMcp = "";
    this.currentClientInfo = createInitialCurrentClientInfo(this.ctx?.directory);
    this.inf = {
      GetCurrentClientInfo: this.GetCurrentClientInfo.bind(this),
      ListSession: this.ListSession.bind(this),
    };
    // Bootstrap fallback logger: keep logs visible before OSGClient logger is ready.
    this.writeLog = async (level, message, extra = {}) => {
      const payload = JSON.stringify({ time: new Date().toISOString(), level, message, extra });
      process.stderr.write(`${payload}\n`);
    };
  }

  async refreshCurrentSessionTitle(): Promise<void> {
    const sessionID = typeof this.currentClientInfo.sessionID === "string" ? this.currentClientInfo.sessionID.trim() : "";
    if (!sessionID) return;

    const directory = typeof this.ctx?.directory === "string" && this.ctx.directory.trim() ? this.ctx.directory.trim() : undefined;

    const readTitle = (value: unknown): string => {
      if (!value || typeof value !== "object") return "";
      const src = value as Record<string, unknown>;
      const title = typeof src.title === "string" ? src.title.trim() : "";
      if (title) return title;
      const info = src.info && typeof src.info === "object" ? (src.info as Record<string, unknown>) : {};
      const infoTitle = typeof info.title === "string" ? info.title.trim() : "";
      if (infoTitle) return infoTitle;
      const session = src.session && typeof src.session === "object" ? (src.session as Record<string, unknown>) : {};
      const sessionTitle = typeof session.title === "string" ? session.title.trim() : "";
      return sessionTitle;
    };

    const result = await this.ctx?.client?.session
      ?.get?.({
        path: { id: sessionID },
        query: directory ? { directory } : undefined,
      })
      .catch(() => null);

    const title = !result || result.error ? "" : readTitle(result.data);
    if (title) {
      this.currentClientInfo.sessionTitle = title;
      return;
    }

    const runtimeQuery = {
      ...(this.query() || {}),
      ...(directory ? { directory } : {}),
    };
    const listResult = await this.ctx?.client?.session?.list?.({ query: runtimeQuery }).catch(() => null);
    if (!listResult || listResult.error || !Array.isArray(listResult.data)) return;

    const matched = listResult.data.find((item: unknown) => {
      if (!item || typeof item !== "object") return false;
      const src = item as Record<string, unknown>;
      return typeof src.id === "string" && src.id.trim() === sessionID;
    });
    const matchedTitle = readTitle(matched);
    if (matchedTitle) {
      this.currentClientInfo.sessionTitle = matchedTitle;
    }
  }

  async GetCurrentClientInfo(): Promise<CurrentClientInfo> {
    await this.refreshCurrentSessionTitle();
    return getCurrentClientInfoSnapshot(this.currentClientInfo);
  }

  async ListSession(payload?: { list?: number; regex?: string; directory?: string }): Promise<SessionListResponse> {
    return readCurrentSessionList(this.ctx, this.query, payload);
  }

  async onEvent(event: any) {
    const result = applyEventToCurrentClientInfo(this.currentClientInfo, event);
    if (result.shouldRefreshTitle) {
      await this.refreshCurrentSessionTitle();
    }
    if (result.selected) {
      await this.writeLog("info", "session selected", await this.GetCurrentClientInfo());
    }
  }

  createWriteLog(logger: any): WriteLog {
    return async (level, message, extra = {}) => {
      const method = level === "error" ? "error" : level === "warn" ? "warn" : "info";
      if (logger && typeof logger[method] === "function") {
        logger[method](message, extra);
        return;
      }
      const payload = JSON.stringify({ time: new Date().toISOString(), level, message, extra });
      process.stderr.write(`${payload}\n`);
    };
  }

  createLogStream(): { write: (line: unknown) => void } {
    return {
      write(line) {
        process.stderr.write(typeof line === "string" ? line : String(line || ""));
      },
    };
  }

  createNullLogStream(): { write: () => void } {
    return {
      write() {
      },
    };
  }

  createFileLogStream(logDir: string): { stream: fs.WriteStream; filePath: string } {
    const dir = typeof logDir === "string" && logDir.trim() ? logDir.trim() : ".opensessiongateway";
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `client-debug-${process.pid}.log`);
    this.logFileStream = fs.createWriteStream(filePath, { flags: "a" });
    return {
      stream: this.logFileStream,
      filePath,
    };
  }

  toastVariant(type: string): "info" | "success" | "error" {
    if (type === "success") return "success";
    if (type === "error") return "error";
    return "info";
  }

  async start() {
    const { wsServerUrl, runtimeID, hostName, logDir } = await buildOsgRuntimeConfig(this.ctx);
    this.runtimeIDForMcp = runtimeID;
    this.wsServerUrlForMcp = wsServerUrl;

    try {
      let logStream = this.createLogStream();
      let logFilePath = "";
      try {
        const file = this.createFileLogStream(logDir);
        logStream = file.stream;
        logFilePath = file.filePath;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.writeLog("warn", "file log stream init failed, fallback to default .opensessiongateway", {
          message,
          logDir,
        });

        try {
          const fallbackFile = this.createFileLogStream(".opensessiongateway");
          logStream = fallbackFile.stream;
          logFilePath = fallbackFile.filePath;
        } catch (fallbackError) {
          const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          await this.writeLog("warn", "default .opensessiongateway init failed, fallback to null stream", {
            fallbackMessage,
          });
          logStream = this.createNullLogStream();
        }
      }

      this.osgClient = new OSGClient(
        {
          wsServerUrl,
          runtimeID,
          hostName,
          logStream,
          WebSocketImpl: WebSocket as unknown as new (url: string) => any,
        },
        {
          showToast: (type: string, message: string, subtitle?: string) => {
            const title = `OSG-${subtitle || "status"}`;
            void this.ctx.client.tui
              .showToast({
                body: {
                  title,
                  message,
                  variant: this.toastVariant(type),
                  duration: 3000,
                },
                query: this.query(),
              })
              .catch(() => {});
          },
          onServerEvent: (message: unknown) =>
            handleServerEvent(message, {
              ctx: this.ctx,
              query: this.query,
              runtimeID: this.runtimeIDForMcp,
              GetCurrentClientInfo: () => this.GetCurrentClientInfo(),
              ListSession: (payload?: { list?: number; regex?: string; directory?: string }) => this.ListSession(payload),
            }),
        },
      );

      this.writeLog = this.createWriteLog(this.osgClient.logger);
      this.osgClient.start();
      await this.writeLog("info", "osg client started", { wsServerUrl, runtimeID, hostName, logDir, logFilePath });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.writeLog("error", "osg client init failed", { message });
    }
  }

  stop() {
    this.osgClient?.stop();
    if (this.logFileStream) {
      try {
        this.logFileStream.end();
      } catch {
      }
      this.logFileStream = null;
    }
  }

  getRuntimeID() {
    return this.runtimeIDForMcp;
  }

  getWsServerUrl() {
    return this.wsServerUrlForMcp;
  }
}
