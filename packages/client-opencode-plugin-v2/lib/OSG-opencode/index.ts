import {
  applyEventToCurrentClientInfo,
  createInitialCurrentClientInfo,
  getCurrentClientInfoSnapshot,
  type CurrentClientInfo,
} from "./ws-event/CurrentClientInfo.js";
import { createClientContentExecuteing } from "./ws-event/ClientContentExecuteing.js";
import { buildPermissionAskedPayload } from "./ws-event/Permission.js";
import { requestInstanceWorkspaceReload } from "./ws-event/RequestInstanceWorkspaceReload.js";
import { readCurrentSessionList, type SessionListResponse } from "./ws-event/SessionList.js";
import { refreshSessionTitle } from "./runtime/refresh-session-title.js";
import { resolveInstanceWorkspaceInfo } from "./runtime/instance-workspace-info.js";
import { OsgManager, type WriteLog } from "./manager.js";
import { PERMISSION_ASKED_EVENT, PERMISSION_UPDATED_EVENT } from "@opensessiongateway/protocol-library";

export class OSGOpencodeClient {
  private readonly ctx: any;
  private readonly query: () => Record<string, unknown>;
  private runtimeIDForMcp: string;
  private wsServerUrlForMcp: string;
  private hostNameForMcp: string;
  private readonly currentClientInfo: CurrentClientInfo;
  private lastReportedContentKey: string;
  readonly inf: {
    GetCurrentClientInfo: () => Promise<Record<string, unknown>>;
    ListSession: (payload?: { list?: number; regex?: string }) => Promise<SessionListResponse>;
    RequestInstanceWorkspaceReload: (payload?: { instanceWorkspaceDirectory?: string; title?: string }) => Promise<Record<string, unknown>>;
  };
  writeLog: WriteLog;

  private toast(type: string, message: string, subtitle?: string) {
    const title = `OSG-${subtitle || "status"}`;
    return this.ctx.client.tui
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
  }

  constructor(ctx: any, query: () => Record<string, unknown>) {
    this.ctx = ctx;
    this.query = query;
    this.runtimeIDForMcp = "";
    this.wsServerUrlForMcp = "";
    this.hostNameForMcp = "";
    this.currentClientInfo = createInitialCurrentClientInfo(this.ctx?.directory);
    this.lastReportedContentKey = "";
    this.inf = {
      GetCurrentClientInfo: this.GetCurrentClientInfo.bind(this),
      ListSession: this.ListSession.bind(this),
      RequestInstanceWorkspaceReload: this.RequestInstanceWorkspaceReload.bind(this),
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

    const directory = typeof this.currentClientInfo.cwd === "string" && this.currentClientInfo.cwd.trim() ? this.currentClientInfo.cwd.trim() : undefined;
    const title = await refreshSessionTitle(this.ctx, this.query, sessionID, directory);
    if (title) this.currentClientInfo.sessionTitle = title;
  }

  async GetCurrentClientInfo(): Promise<Record<string, unknown>> {
    const query = this.query();
    return {
      runtimeID: this.runtimeIDForMcp || "unknown",
      hostName: this.hostNameForMcp || "unknown",
      displayID: query && typeof query.displayID === "string" ? query.displayID : undefined,
      ...getCurrentClientInfoSnapshot(this.currentClientInfo),
    };
  }

  async ListSession(payload?: { list?: number; regex?: string }): Promise<SessionListResponse> {
    return readCurrentSessionList(this.ctx, this.query, payload);
  }

  async onEvent(event: any) {
    const previousCwd = this.currentClientInfo.cwd
    const previousSessionID = this.currentClientInfo.sessionID
    const previousTitle = this.currentClientInfo.sessionTitle
    const result = applyEventToCurrentClientInfo(this.currentClientInfo, event);
    const type = event && typeof event === "object" && typeof event.type === "string" ? event.type : ""
    const props = event && typeof event === "object" && event.properties && typeof event.properties === "object"
      ? event.properties as Record<string, unknown>
      : {}
    if (type === "permission.asked") {
      const permissionPayload = buildPermissionAskedPayload({
        event: event && typeof event === "object" ? event as Record<string, unknown> : { type, properties: props },
        currentClientInfo: this.currentClientInfo,
        instanceWorkspace: this.resolveInstanceWorkspaceInfo(),
        query: this.query,
      })
      if (permissionPayload) {
        const sent = OsgManager.sendPermissionAsked(this.key(), permissionPayload)
        if (!sent) {
          void this.writeLog("warn", "permission report failed", { permissionID: permissionPayload.permissionID })
        }
      } else {
        void this.writeLog("warn", "permission report skipped", { reason: "incomplete permission payload" })
      }
    }
    const isTui = type.startsWith("tui.")
    if (result.shouldRefreshTitle) {
      await this.refreshCurrentSessionTitle();
    }
    if (result.selected) {
      await this.writeLog("info", "session selected", await this.GetCurrentClientInfo());
    }
    const nextCwd = this.currentClientInfo.cwd
    const nextSessionID = this.currentClientInfo.sessionID
    const nextTitle = this.currentClientInfo.sessionTitle
    const query = this.query()
    const displayID = typeof props.displayID === "string" && props.displayID.trim()
      ? props.displayID.trim()
      : query && typeof query.displayID === "string" ? query.displayID : undefined

    if (isTui && displayID) {
      this.reportClientContentExecuteing({
        displayID,
        instanceWorkspaceDirectory: nextCwd || undefined,
        session: nextSessionID
          ? {
              sessionID: nextSessionID,
              title: nextTitle,
              status: this.sessionStatus(type, this.currentClientInfo.status),
            }
          : undefined,
      })
      return
    }

    if (
      nextSessionID
      && (
        result.selected
        || nextSessionID !== previousSessionID
        || nextTitle !== previousTitle
        || type === "session.created"
        || type === "session.updated"
        || type === "session.status"
        || type === "session.idle"
        || type === "session.error"
        || type === "permission.asked"
      )
    ) {
      this.reportClientContentExecuteing({
        session: {
          sessionID: nextSessionID,
          title: nextTitle,
          status: this.sessionStatus(type, this.currentClientInfo.status),
        },
        instanceWorkspaceDirectory: nextCwd || undefined,
      })
      return
    }

    if (type === "server.instance.disposed") {
      this.reportClientContentExecuteing({ instanceWorkspaceDirectory: nextCwd || undefined })
      return
    }

    if (nextCwd && nextCwd !== previousCwd) {
      this.reportClientContentExecuteing({ instanceWorkspaceDirectory: nextCwd })
    }
  }

  toastVariant(type: string): "info" | "success" | "error" {
    if (type === "success") return "success";
    if (type === "error") return "error";
    return "info";
  }

  resolveInstanceWorkspaceInfo() {
    return resolveInstanceWorkspaceInfo(this.currentClientInfo);
  }

  private key() {
    const dir = typeof this.ctx?.directory === "string" ? this.ctx.directory.trim() : ""
    if (!dir) {
      throw new Error("ctx.directory is required")
    }
    return dir
  }

  getSessionID() {
    return this.currentClientInfo.sessionID || ""
  }

  reportClientContentExecuteing(input: {
    displayID?: string
    instanceWorkspaceDirectory?: string
    session?: {
      sessionID?: string
      title?: string
      status?: "idle" | "busy" | "error"
    }
  } = {}, force = false) {
    const payload = createClientContentExecuteing({
      displayID: input.displayID,
      instanceWorkspaceDirectory: input.instanceWorkspaceDirectory,
      session: input.session,
    })
    const nextKey = JSON.stringify(payload)
    if (!force && nextKey === this.lastReportedContentKey) return false
    const sent = OsgManager.report(payload)
    if (!sent) {
      void this.writeLog("warn", "osg plugin upload failed", { payload: nextKey })
      return false
    }

    this.lastReportedContentKey = nextKey
    void this.writeLog("info", "osg plugin upload", { payload: nextKey })
    return true
  }

  async RequestInstanceWorkspaceReload(payload?: { instanceWorkspaceDirectory?: string; title?: string }): Promise<Record<string, unknown>> {
    return requestInstanceWorkspaceReload(this.ctx, payload);
  }

  private sessionStatus(type: string, current: string): "idle" | "busy" | "error" {
    if (type === "session.idle") return "idle"
    if (type === "session.error" || type === "permission.asked") return "error"
    if (type === "session.status") {
      if (current === "Idle") return "idle"
      if (current === "Interrupted") return "error"
      return "busy"
    }
    if (current === "Idle") return "idle"
    if (current === "Interrupted") return "error"
    return "busy"
  }

  async start() {
    OsgManager.register(this.key(), {
      ctx: this.ctx,
      query: this.query,
      writeLog: this.writeLog,
      GetCurrentClientInfo: () => this.GetCurrentClientInfo(),
      ListSession: (payload?: { list?: number; regex?: string }) => this.ListSession(payload),
      RequestInstanceWorkspaceReload: (payload?: { instanceWorkspaceDirectory?: string; title?: string }) => this.RequestInstanceWorkspaceReload(payload),
      resolveInstanceWorkspaceInfo: () => this.resolveInstanceWorkspaceInfo(),
      sendPermissionUpdated: (payload: Record<string, unknown>) => OsgManager.sendEvent(PERMISSION_UPDATED_EVENT, payload),
      reportClientContentExecuteing: (payload, force) => this.reportClientContentExecuteing(payload, force),
      getSessionID: () => this.getSessionID(),
    })
    const result = await OsgManager.start({
      ctx: this.ctx,
      query: this.query,
      writeLog: this.writeLog,
      GetCurrentClientInfo: () => this.GetCurrentClientInfo(),
      ListSession: (payload?: { list?: number; regex?: string }) => this.ListSession(payload),
      RequestInstanceWorkspaceReload: (payload?: { instanceWorkspaceDirectory?: string; title?: string }) => this.RequestInstanceWorkspaceReload(payload),
      resolveInstanceWorkspaceInfo: () => this.resolveInstanceWorkspaceInfo(),
      sendPermissionUpdated: (payload: Record<string, unknown>) => OsgManager.sendEvent(PERMISSION_UPDATED_EVENT, payload),
      reportClientContentExecuteing: (payload, force) => this.reportClientContentExecuteing(payload, force),
      getSessionID: () => this.getSessionID(),
    })
    this.runtimeIDForMcp = result.runtimeID
    this.wsServerUrlForMcp = result.wsServerUrl
    this.hostNameForMcp = result.hostName
    this.writeLog = result.writeLog
    this.reportClientContentExecuteing({ instanceWorkspaceDirectory: this.currentClientInfo.cwd || undefined })
  }

  stop() {
    OsgManager.unregister(this.key())
  }

  getRuntimeID() {
    return this.runtimeIDForMcp;
  }

  getWsServerUrl() {
    return this.wsServerUrlForMcp;
  }

  getInstanceWorkspaceDirectoryForMcp() {
    return this.key();
  }
}
