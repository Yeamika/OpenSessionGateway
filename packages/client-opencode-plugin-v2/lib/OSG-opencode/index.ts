import {
  applyEventToCurrentClientInfo,
  createInitialCurrentClientInfo,
  getCurrentClientInfoSnapshot,
  type CurrentClientInfo,
} from "./ws-event/CurrentClientInfo.js";
import { createClientContentExecuteing } from "./ws-event/ClientContentExecuteing.js";
import { buildPermissionAskedPayload } from "./ws-event/Permission.js";
import { buildQuestionAskedPayload, buildQuestionUpdatedPayload } from "./ws-event/Question.js";
import { requestInstanceWorkspaceReload } from "./ws-event/RequestInstanceWorkspaceReload.js";
import { readCurrentSessionList, type SessionListResponse } from "./ws-event/SessionList.js";
import { refreshSessionTitle } from "./runtime/refresh-session-title.js";
import { resolveInstanceWorkspaceInfo } from "./runtime/instance-workspace-info.js";
import { OsgManager, type WriteLog } from "./manager.js";
import {
  legacySessionStatusFromState,
  type ClientSessionMeta,
  type ClientSessionReason,
  type ClientSessionState,
} from "@opensessiongateway/protocol-library/ws-protocol/ClientContentExecuteing.js";
import {
  PERMISSION_ASKED_EVENT,
  PERMISSION_UPDATED_EVENT,
  QUESTION_ASKED_EVENT,
  QUESTION_UPDATED_EVENT,
} from "@opensessiongateway/protocol-library";

type SessionStateRow = {
  state: ClientSessionState;
  reason: ClientSessionReason | null;
  meta: ClientSessionMeta | null;
  touched: boolean;
};

type ToolRow = {
  partID: string;
  context: string;
  tool: string;
  startedAt: string;
};

type ReasoningRow = {
  partID: string;
  text: string;
  updatedAt: string;
};

type TextRow = {
  partID: string;
  text: string;
  updatedAt: string;
};

type CompactionRow = {
  partID: string;
  startedAt: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function clean(value: string) {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    .replace(/[*_~]+/g, "")
    .trim();
}

function heading(value: string) {
  const text = value.replace(/\r\n?/g, "\n");

  const html = text.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
  if (html?.[1]) {
    const next = clean(html[1].replace(/<[^>]+>/g, " "));
    if (next) return next;
  }

  const atx = text.match(/^\s{0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/m);
  if (atx?.[1]) {
    const next = clean(atx[1]);
    if (next) return next;
  }

  const setext = text.match(/^([^\n]+)\n(?:=+|-+)\s*$/m);
  if (setext?.[1]) {
    const next = clean(setext[1]);
    if (next) return next;
  }

  const strong = text.match(/^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*$/m);
  if (strong?.[1]) {
    const next = clean(strong[1]);
    if (next) return next;
  }

  return "";
}

function fallbackTopic(value: string, limit = 10) {
  const text = clean(value.replace(/\r\n?/g, "\n").replace(/\s+/g, " "));
  if (!text) return "";
  const chars = Array.from(text);
  if (chars.length <= limit) return text;
  return `${chars.slice(0, limit).join("")}...`;
}

function file(value: unknown) {
  const path = text(value).replace(/[\\/]+$/, "");
  if (!path) return "";
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

function location(value: unknown) {
  return text(value).replace(/[\\/]+$/, "");
}

function count(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function time(value: unknown) {
  const raw = Number(value);
  if (Number.isFinite(raw) && raw > 0) return new Date(raw).toISOString();
  return new Date().toISOString();
}

function toolContext(tool: string, args: Record<string, unknown>, raw = "") {
  let detail = "";
  switch (tool) {
    case "read":
    case "edit":
    case "write":
      detail = location(args.filePath) || file(args.filePath);
      break;
    case "list":
      detail = location(args.path) || file(args.path);
      break;
    case "glob":
    case "grep":
      detail = text(args.pattern);
      break;
    case "webfetch":
      detail = text(args.url);
      break;
    case "websearch":
    case "codesearch":
      detail = text(args.query);
      break;
    case "task":
      detail = text(args.description);
      break;
    case "bash":
      detail = text(args.command) || text(args.description) || fallbackTopic(raw, 32);
      break;
    case "apply_patch": {
      const size = count(args.files);
      detail = size > 0 ? `${size} file${size > 1 ? "s" : ""}` : "";
      break;
    }
    default:
      detail = "";
      break;
  }
  if (!tool) return detail;
  if (!detail) return tool;
  return `${tool} ${detail}`;
}

function thinkingMeta(value: string) {
  return {
    subtitle: heading(value),
    context: fallbackTopic(value),
  };
}

function eventSource(props: Record<string, unknown>, kind: "permission" | "question") {
  const rows = kind === "permission"
    ? [record(props.permission), record(props.ask), record(props.request), record(props.info), props]
    : [record(props.question), record(props.request), record(props.info), props];
  return rows.find((item) => Object.keys(item).length > 0) || {};
}

function permissionMeta(props: Record<string, unknown>): ClientSessionMeta | null {
  const src = eventSource(props, "permission");
  const subtitle = text(src.title || src.label || src.name || src.permission || src.kind || src.type);
  const path = text(record(src.metadata).filepath);
  const context = path || text((src.patterns as unknown[] | undefined)?.[0]);
  return subtitle || context ? { subtitle, context } : null;
}

function questionMeta(props: Record<string, unknown>): ClientSessionMeta | null {
  const src = eventSource(props, "question");
  const first = Array.isArray(src.questions) ? record(src.questions[0]) : {};
  const subtitle = text(src.title || src.header || first.header || src.question || first.question);
  const context = text(src.question || first.question);
  return subtitle || context ? { subtitle, context } : null;
}

function errorState(props: Record<string, unknown>): { reason: "aborted" | "error"; meta: ClientSessionMeta } {
  const err = record(props.error);
  const data = record(err.data);
  const name = text(err.name);
  const message = text(data.message) || text(err.message) || name || "session error";
  const reason = name === "MessageAbortedError" || /abort/i.test(message) ? "aborted" : "error";
  return {
    reason,
    meta: {
      message,
    },
  };
}

export class OSGOpencodeClient {
  private readonly ctx: any;
  private readonly query: () => Record<string, unknown>;
  private runtimeIDForMcp: string;
  private wsServerUrlForMcp: string;
  private hostNameForMcp: string;
  private readonly currentClientInfo: CurrentClientInfo;
  private lastReportedContentKey: string;
  private readonly sessionExecutionWaiters: Map<string, Array<{ resolve: (value: { ok: boolean; error?: string }) => void; timeout: ReturnType<typeof setTimeout> }>>;
  private readonly sessionStates: Map<string, SessionStateRow>;
  private readonly sessionTools: Map<string, Map<string, ToolRow>>;
  private readonly sessionCompactions: Map<string, CompactionRow>;
  private readonly sessionTexts: Map<string, TextRow>;
  private readonly sessionReasonings: Map<string, ReasoningRow>;
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
    this.sessionExecutionWaiters = new Map();
    this.sessionStates = new Map();
    this.sessionTools = new Map();
    this.sessionCompactions = new Map();
    this.sessionTexts = new Map();
    this.sessionReasonings = new Map();
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

  private getSessionState(sessionID: string): SessionStateRow | null {
    const clean = text(sessionID);
    if (!clean) return null;
    return this.sessionStates.get(clean) || null;
  }

  private ensureSessionState(sessionID: string): SessionStateRow | null {
    const clean = text(sessionID);
    if (!clean) return null;
    const hit = this.getSessionState(clean);
    if (hit) return hit;
    const created: SessionStateRow = {
      state: "idle",
      reason: "pending",
      meta: null,
      touched: false,
    };
    this.sessionStates.set(clean, created);
    return created;
  }

  private syncCurrentSessionState() {
    const sessionID = text(this.currentClientInfo.sessionID);
    const hit = sessionID ? this.getSessionState(sessionID) : null;
    this.currentClientInfo.sessionState = hit?.state || null;
    this.currentClientInfo.sessionReason = hit?.reason || null;
    this.currentClientInfo.sessionMeta = hit?.meta || null;
  }

  private seedPendingSession(sessionID: string) {
    const hit = this.ensureSessionState(sessionID);
    if (!hit) return;
    if (!hit.touched) {
      hit.state = "idle";
      hit.reason = "pending";
      hit.meta = null;
    }
    this.syncCurrentSessionState();
  }

  private setSessionState(
    sessionID: string,
    state: ClientSessionState,
    reason: ClientSessionReason | null,
    meta: ClientSessionMeta | null,
    touched = false,
  ) {
    const hit = this.ensureSessionState(sessionID);
    if (!hit) return;
    hit.state = state;
    hit.reason = reason;
    hit.meta = meta;
    hit.touched = touched || hit.touched;
    this.syncCurrentSessionState();
  }

  private activeTool(sessionID: string): ToolRow | null {
    const rows = this.sessionTools.get(text(sessionID));
    if (!rows || rows.size === 0) return null;
    return [...rows.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt)).pop() || null;
  }

  private activeReasoning(sessionID: string): ReasoningRow | null {
    const hit = this.sessionReasonings.get(text(sessionID));
    if (!hit || !hit.text.trim()) return null;
    return hit;
  }

  private activeText(sessionID: string): TextRow | null {
    const hit = this.sessionTexts.get(text(sessionID));
    if (!hit) return null;
    return hit;
  }

  private refreshBusyState(sessionID: string) {
    const clean = text(sessionID);
    if (!clean) return;
    const hit = this.getSessionState(clean);
    if (!hit || hit.state !== "busy") return;
    this.setBusyState(clean);
    this.reportSessionState(clean);
  }

  private upsertToolPart(sessionID: string, part: Record<string, unknown>) {
    const cleanSessionID = text(sessionID);
    const partID = text(part.id);
    if (!cleanSessionID || !partID) return;
    const state = record(part.state);
    const status = text(state.status);
    const rows = this.sessionTools.get(cleanSessionID);

    if (status !== "pending" && status !== "running") {
      if (!rows) return;
      rows.delete(partID);
      if (rows.size === 0) this.sessionTools.delete(cleanSessionID);
      this.refreshBusyState(cleanSessionID);
      return;
    }

    const next = rows || new Map<string, ToolRow>();
    const input = record(state.input);
    const raw = text(state.raw);
    const tool = text(part.tool);
    const context = toolContext(tool, input, raw);
    if (status === "pending" && (!context || context === tool)) {
      next.set(partID, {
        partID,
        tool,
        context: tool,
        startedAt: time(record(state.time).start),
      });
      this.sessionTools.set(cleanSessionID, next);
      return;
    }
    next.set(partID, {
      partID,
      tool,
      context,
      startedAt: time(record(state.time).start),
    });
    this.sessionTools.set(cleanSessionID, next);
    this.refreshBusyState(cleanSessionID);
  }

  private backfillToolContext(sessionID: string, detail: string, tools?: string[]) {
    const cleanSessionID = text(sessionID);
    const nextDetail = text(detail);
    if (!cleanSessionID || !nextDetail) return false;
    const hit = this.activeTool(cleanSessionID);
    if (!hit) return false;
    if (Array.isArray(tools) && tools.length > 0 && !tools.includes(hit.tool)) return false;
    if (hit.context && hit.context !== hit.tool) return false;
    const rows = this.sessionTools.get(cleanSessionID);
    if (!rows) return false;
    rows.set(hit.partID, {
      ...hit,
      context: `${hit.tool} ${nextDetail}`,
    });
    return true;
  }

  private upsertCompactionPart(sessionID: string, part: Record<string, unknown>) {
    const cleanSessionID = text(sessionID);
    const partID = text(part.id);
    if (!cleanSessionID || !partID) return;
    this.sessionCompactions.set(cleanSessionID, {
      partID,
      startedAt: new Date().toISOString(),
    });
    this.refreshBusyState(cleanSessionID);
  }

  private upsertTextPart(sessionID: string, part: Record<string, unknown>) {
    const cleanSessionID = text(sessionID);
    const partID = text(part.id);
    if (!cleanSessionID || !partID) return;
    this.sessionTexts.set(cleanSessionID, {
      partID,
      text: text(part.text),
      updatedAt: new Date().toISOString(),
    });
    this.refreshBusyState(cleanSessionID);
  }

  private clearText(sessionID: string, partID: string) {
    const cleanSessionID = text(sessionID);
    const cleanPartID = text(partID);
    if (!cleanSessionID || !cleanPartID) return;
    const hit = this.sessionTexts.get(cleanSessionID);
    if (!hit || hit.partID !== cleanPartID) return;
    this.sessionTexts.delete(cleanSessionID);
    this.refreshBusyState(cleanSessionID);
  }

  private clearCompaction(sessionID: string, partID?: string) {
    const cleanSessionID = text(sessionID);
    if (!cleanSessionID) return;
    const hit = this.sessionCompactions.get(cleanSessionID);
    if (!hit) return;
    if (partID && hit.partID !== text(partID)) return;
    this.sessionCompactions.delete(cleanSessionID);
    this.refreshBusyState(cleanSessionID);
  }

  private removePartState(sessionID: string, partID: string) {
    const cleanSessionID = text(sessionID);
    const cleanPartID = text(partID);
    if (!cleanSessionID || !cleanPartID) return;
    const rows = this.sessionTools.get(cleanSessionID);
    if (rows) {
      rows.delete(cleanPartID);
      if (rows.size === 0) this.sessionTools.delete(cleanSessionID);
    }
    const textRow = this.sessionTexts.get(cleanSessionID);
    if (textRow?.partID === cleanPartID) {
      this.sessionTexts.delete(cleanSessionID);
    }
    const reasoning = this.sessionReasonings.get(cleanSessionID);
    if (reasoning?.partID === cleanPartID) {
      this.sessionReasonings.delete(cleanSessionID);
    }
    this.clearCompaction(cleanSessionID, cleanPartID);
    this.refreshBusyState(cleanSessionID);
  }

  private setBusyState(sessionID: string, meta?: ClientSessionMeta | null) {
    const clean = text(sessionID);
    if (!clean) return;
    const compacting = this.sessionCompactions.get(clean);
    if (compacting) {
      this.setSessionState(clean, "busy", "compacting", meta || null, true);
      return;
    }
    const tool = this.activeTool(clean);
    if (tool) {
      this.setSessionState(clean, "busy", "tool", { ...(meta || {}), context: tool.context || undefined }, true);
      return;
    }
    const textRow = this.activeText(clean);
    if (textRow) {
      this.setSessionState(clean, "busy", "generating", {
        ...(meta || {}),
        context: fallbackTopic(textRow.text, 24) || meta?.context || undefined,
      }, true);
      return;
    }
    const reasoning = this.activeReasoning(clean);
    if (reasoning) {
      const next = thinkingMeta(reasoning.text);
      this.setSessionState(clean, "busy", "reasoning", {
        subtitle: next.subtitle || "",
        context: next.context || undefined,
        ...(meta || {}),
      }, true);
      return;
    }
    this.setSessionState(clean, "busy", null, meta || null, true);
  }

  private clearSessionState(sessionID: string) {
    const clean = text(sessionID);
    if (!clean) return;
    this.sessionStates.delete(clean);
    this.sessionTools.delete(clean);
    this.sessionCompactions.delete(clean);
    this.sessionTexts.delete(clean);
    this.sessionReasonings.delete(clean);
    this.syncCurrentSessionState();
  }

  private setReasoning(sessionID: string, partID: string, value: string) {
    const cleanSessionID = text(sessionID);
    const cleanPartID = text(partID);
    if (!cleanSessionID || !cleanPartID) return;
    const updatedAt = new Date().toISOString();
    this.sessionReasonings.set(cleanSessionID, {
      partID: cleanPartID,
      text: value,
      updatedAt,
    });
    const hit = this.getSessionState(cleanSessionID);
    if (!hit || hit.state !== "busy") return;
    if (hit.reason === "tool" || hit.reason === "compacting") return;
    if (!value.trim()) return;
    const next = thinkingMeta(value);
    this.setSessionState(cleanSessionID, "busy", "reasoning", {
      subtitle: next.subtitle || "",
      context: next.context || undefined,
    }, true);
    this.reportSessionState(cleanSessionID);
  }

  private clearReasoning(sessionID: string, partID: string) {
    const cleanSessionID = text(sessionID);
    const cleanPartID = text(partID);
    if (!cleanSessionID || !cleanPartID) return;
    const hit = this.sessionReasonings.get(cleanSessionID);
    if (!hit || hit.partID !== cleanPartID) return;
    this.sessionReasonings.delete(cleanSessionID);
    this.refreshBusyState(cleanSessionID);
  }

  private patchReasoning(sessionID: string, partID: string, delta: string) {
    const cleanSessionID = text(sessionID);
    const cleanPartID = text(partID);
    const chunk = typeof delta === "string" ? delta : "";
    if (!cleanSessionID || !cleanPartID || !chunk) return;
    const hit = this.sessionReasonings.get(cleanSessionID);
    if (!hit || hit.partID !== cleanPartID) return;
    const textValue = hit.text + chunk;
    this.setReasoning(cleanSessionID, cleanPartID, textValue);
  }

  private sessionPayload(sessionID?: string, title?: string, status?: "idle" | "busy" | "error") {
    const clean = text(sessionID);
    if (!clean) return undefined;
    const hit = this.getSessionState(clean);
    return {
      sessionID: clean,
      title: text(title) || undefined,
      status: legacySessionStatusFromState(hit?.state, status),
      state: hit?.state || null,
      reason: hit?.reason || null,
      meta: hit?.meta || null,
    };
  }

  private reportSessionState(sessionID: string, force = false) {
    const clean = text(sessionID);
    if (!clean) return false;
    const query = this.query();
    return this.reportClientContentExecuteing({
      displayID: clean === this.currentClientInfo.sessionID && typeof query.displayID === "string"
        ? query.displayID
        : undefined,
      instanceWorkspaceDirectory: this.currentClientInfo.cwd || undefined,
      session: this.sessionPayload(
        clean,
        clean === this.currentClientInfo.sessionID ? this.currentClientInfo.sessionTitle : undefined,
      ),
    }, force);
  }

  async onEvent(event: any) {
    this.resolveSessionExecutionWaiters(event)
    const previousCwd = this.currentClientInfo.cwd
    const previousSessionID = this.currentClientInfo.sessionID
    const previousTitle = this.currentClientInfo.sessionTitle
    const result = applyEventToCurrentClientInfo(this.currentClientInfo, event);
    const type = event && typeof event === "object" && typeof event.type === "string" ? event.type : ""
    const props = event && typeof event === "object" && event.properties && typeof event.properties === "object"
      ? event.properties as Record<string, unknown>
      : {}
    const eventSessionID = this.readEventSessionID(event)
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
    if (type === "question.asked") {
      const questionPayload = buildQuestionAskedPayload({
        event: event && typeof event === "object" ? event as Record<string, unknown> : { type, properties: props },
        query: this.query,
      })
      if (questionPayload) {
        if (!OsgManager.sendQuestionAsked(this.key(), questionPayload)) {
          void this.writeLog("warn", "question report failed", { questionID: questionPayload.questionID })
        }
      }
    }
    if (type === "question.replied" || type === "question.rejected") {
      const questionUpdatedPayload = buildQuestionUpdatedPayload({
        event: event && typeof event === "object" ? event as Record<string, unknown> : { type, properties: props },
        status: type === "question.replied" ? "answered" : "rejected",
      })
      if (questionUpdatedPayload) {
        if (!OsgManager.sendEvent(QUESTION_UPDATED_EVENT, questionUpdatedPayload)) {
          void this.writeLog("warn", "question update report failed", { questionID: questionUpdatedPayload.questionID })
        }
      }
    }
    if (result.selected) {
      this.seedPendingSession(this.currentClientInfo.sessionID)
    }
    if (type === "session.created") {
      this.seedPendingSession(eventSessionID || this.currentClientInfo.sessionID)
    }
    if (type === "session.deleted") {
      this.clearSessionState(eventSessionID)
    }
    if (type === "session.status") {
      const status = record(props.status)
      const statusType = text(status.type)
      if (statusType === "busy") {
        this.setBusyState(eventSessionID)
      }
      if (statusType === "retry") {
        this.setSessionState(eventSessionID, "busy", "generating", null, true)
      }
      if (statusType === "idle") {
        const hit = this.ensureSessionState(eventSessionID)
        this.setSessionState(eventSessionID, "idle", hit?.touched ? "completed" : "pending", null, hit?.touched === true)
      }
    }
    if (type === "session.idle") {
      const hit = this.ensureSessionState(eventSessionID)
      this.sessionCompactions.delete(text(eventSessionID))
      this.sessionTools.delete(text(eventSessionID))
      this.sessionTexts.delete(text(eventSessionID))
      this.sessionReasonings.delete(text(eventSessionID))
      this.setSessionState(eventSessionID, "idle", hit?.touched ? "completed" : "pending", null, hit?.touched === true)
    }
    if (type === "permission.asked") {
      const meta = permissionMeta(props)
      if (this.backfillToolContext(eventSessionID, text(meta?.context), ["read", "edit", "write", "list"])) {
        this.setBusyState(eventSessionID)
        this.reportSessionState(eventSessionID, true)
      }
      this.setSessionState(eventSessionID, "waiting", "permission", meta, true)
    }
    if (type === "question.asked") {
      const meta = questionMeta(props)
      if (this.backfillToolContext(eventSessionID, text(meta?.context) || text(meta?.subtitle), ["question"])) {
        this.setBusyState(eventSessionID)
        this.reportSessionState(eventSessionID, true)
      }
      this.setSessionState(eventSessionID, "waiting", "question", meta, true)
    }
    if (type === "session.compacted") {
      this.clearCompaction(eventSessionID)
      this.setBusyState(eventSessionID)
    }
    if (type === "session.error") {
      this.sessionCompactions.delete(text(eventSessionID))
      this.sessionTools.delete(text(eventSessionID))
      this.sessionTexts.delete(text(eventSessionID))
      this.sessionReasonings.delete(text(eventSessionID))
      const next = errorState(props)
      this.setSessionState(eventSessionID, "stopped", next.reason, next.meta, true)
    }
    if (type === "message.part.updated") {
      const part = record(props.part)
      const partType = text(part.type)
      if (partType === "tool") {
        this.upsertToolPart(eventSessionID, part)
      }
      if (partType === "compaction") {
        this.upsertCompactionPart(eventSessionID, part)
      }
      if (partType === "reasoning") {
        if (record(part.time).end !== undefined && record(part.time).end !== null) {
          this.clearReasoning(eventSessionID, text(part.id))
        } else {
          this.setReasoning(eventSessionID, text(part.id), text(part.text))
        }
      }
      if (partType === "text") {
        if (record(part.time).end !== undefined && record(part.time).end !== null) {
          this.clearText(eventSessionID, text(part.id))
        } else {
          this.upsertTextPart(eventSessionID, part)
        }
      }
    }
    if (type === "message.part.removed") {
      this.removePartState(eventSessionID, text(props.partID))
    }
    if (type === "message.part.delta") {
      if (text(props.field) === "text") {
        this.patchReasoning(eventSessionID, text(props.partID), text(props.delta))
      }
    }
    this.syncCurrentSessionState()
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
              status: this.sessionStatus(nextSessionID, type, this.currentClientInfo.status),
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
        || type === "session.compacted"
        || type === "permission.asked"
        || type === "question.asked"
      )
    ) {
        this.reportClientContentExecuteing({
          session: {
            sessionID: nextSessionID,
            title: nextTitle,
            status: this.sessionStatus(nextSessionID, type, this.currentClientInfo.status),
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

  private readEventSessionID(event: unknown): string {
    const src = event && typeof event === "object" ? (event as Record<string, unknown>) : {}
    const props = src.properties && typeof src.properties === "object" ? (src.properties as Record<string, unknown>) : {}
    if (typeof props.sessionID === "string" && props.sessionID.trim()) return props.sessionID.trim()
    const info = props.info && typeof props.info === "object" ? (props.info as Record<string, unknown>) : {}
    if (typeof info.id === "string" && info.id.trim()) return info.id.trim()
    const session = props.session && typeof props.session === "object" ? (props.session as Record<string, unknown>) : {}
    if (typeof session.id === "string" && session.id.trim()) return session.id.trim()
    return ""
  }

  private settleSessionExecutionWaiters(sessionID: string, result: { ok: boolean; error?: string }) {
    const cleanSessionID = typeof sessionID === "string" ? sessionID.trim() : ""
    if (!cleanSessionID) return
    const waiters = this.sessionExecutionWaiters.get(cleanSessionID)
    if (!waiters || waiters.length === 0) return
    this.sessionExecutionWaiters.delete(cleanSessionID)
    for (const item of waiters) {
      clearTimeout(item.timeout)
      item.resolve(result)
    }
  }

  private resolveSessionExecutionWaiters(event: unknown) {
    const src = event && typeof event === "object" ? (event as Record<string, unknown>) : {}
    const type = typeof src.type === "string" ? src.type.trim() : ""
    const sessionID = this.readEventSessionID(src)
    if (!type || !sessionID) return
    const props = src.properties && typeof src.properties === "object" ? (src.properties as Record<string, unknown>) : {}
    if (type === "session.status") {
      const status = props.status && typeof props.status === "object" ? (props.status as Record<string, unknown>) : {}
      const statusType = typeof status.type === "string" ? status.type.trim() : ""
      if (statusType === "busy") {
        this.settleSessionExecutionWaiters(sessionID, { ok: true })
        return
      }
      if (statusType === "retry") {
        const message = typeof status.message === "string" ? status.message.trim() : ""
        this.settleSessionExecutionWaiters(sessionID, { ok: false, error: message || "session entered retry state" })
        return
      }
      if (statusType === "idle") {
        this.settleSessionExecutionWaiters(sessionID, { ok: true })
        return
      }
    }
    if (type === "permission.asked" || type === "question.asked") {
      this.settleSessionExecutionWaiters(sessionID, { ok: true })
      return
    }
    if (type === "session.error") {
      const error = props.error && typeof props.error === "object" ? (props.error as Record<string, unknown>) : {}
      const data = error.data && typeof error.data === "object" ? (error.data as Record<string, unknown>) : {}
      const name = typeof error.name === "string" ? error.name.trim() : ""
      const message = typeof data.message === "string" ? data.message.trim() : ""
      this.settleSessionExecutionWaiters(sessionID, { ok: false, error: message || name || "session error" })
      return
    }
    if (type === "session.idle") {
      this.settleSessionExecutionWaiters(sessionID, { ok: true })
    }
  }

  async WaitForSessionExecutionStart(sessionID: string): Promise<{ ok: boolean; error?: string }> {
    const cleanSessionID = typeof sessionID === "string" ? sessionID.trim() : ""
    if (!cleanSessionID) return { ok: false, error: "sessionID is required" }
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        const rows = this.sessionExecutionWaiters.get(cleanSessionID) || []
        const next = rows.filter((item) => item.timeout !== timeout)
        if (next.length > 0) this.sessionExecutionWaiters.set(cleanSessionID, next)
        else this.sessionExecutionWaiters.delete(cleanSessionID)
        resolve({ ok: false, error: "session did not start executing in time" })
      }, 8000)
      const rows = this.sessionExecutionWaiters.get(cleanSessionID) || []
      rows.push({ resolve, timeout })
      this.sessionExecutionWaiters.set(cleanSessionID, rows)
    })
  }

  reportClientContentExecuteing(input: {
    displayID?: string
    instanceWorkspaceDirectory?: string
    session?: {
      sessionID?: string
      title?: string
      status?: "idle" | "busy" | "error"
      state?: ClientSessionState | null
      reason?: ClientSessionReason | null
      meta?: ClientSessionMeta | null
    }
  } = {}, force = false) {
    const session = input.session?.sessionID
      ? this.sessionPayload(input.session.sessionID, input.session.title, input.session.status)
      : undefined
    const payload = createClientContentExecuteing({
      displayID: input.displayID,
      instanceWorkspaceDirectory: input.instanceWorkspaceDirectory,
      session: input.session?.sessionID
        ? {
            ...session,
            state: input.session.state ?? session?.state ?? null,
            reason: input.session.reason ?? session?.reason ?? null,
            meta: input.session.meta ?? session?.meta ?? null,
          }
        : undefined,
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

  private sessionStatus(sessionID: string, type: string, current: string): "idle" | "busy" | "error" {
    const status = legacySessionStatusFromState(this.getSessionState(sessionID)?.state);
    if (status) return status;
    if (type === "session.idle") return "idle"
    if (type === "session.error" || type === "permission.asked" || type === "question.asked") return "error"
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
      WaitForSessionExecutionStart: (sessionID: string) => this.WaitForSessionExecutionStart(sessionID),
      ListSession: (payload?: { list?: number; regex?: string }) => this.ListSession(payload),
      RequestInstanceWorkspaceReload: (payload?: { instanceWorkspaceDirectory?: string; title?: string }) => this.RequestInstanceWorkspaceReload(payload),
      resolveInstanceWorkspaceInfo: () => this.resolveInstanceWorkspaceInfo(),
      sendPermissionUpdated: (payload: Record<string, unknown>) => OsgManager.sendEvent(PERMISSION_UPDATED_EVENT, payload),
      sendQuestionUpdated: (payload: Record<string, unknown>) => OsgManager.sendEvent(QUESTION_UPDATED_EVENT, payload),
      reportClientContentExecuteing: (payload, force) => this.reportClientContentExecuteing(payload, force),
      getSessionID: () => this.getSessionID(),
    })
    const result = await OsgManager.start({
      ctx: this.ctx,
      query: this.query,
      writeLog: this.writeLog,
      GetCurrentClientInfo: () => this.GetCurrentClientInfo(),
      WaitForSessionExecutionStart: (sessionID: string) => this.WaitForSessionExecutionStart(sessionID),
      ListSession: (payload?: { list?: number; regex?: string }) => this.ListSession(payload),
      RequestInstanceWorkspaceReload: (payload?: { instanceWorkspaceDirectory?: string; title?: string }) => this.RequestInstanceWorkspaceReload(payload),
      resolveInstanceWorkspaceInfo: () => this.resolveInstanceWorkspaceInfo(),
      sendPermissionUpdated: (payload: Record<string, unknown>) => OsgManager.sendEvent(PERMISSION_UPDATED_EVENT, payload),
      sendQuestionUpdated: (payload: Record<string, unknown>) => OsgManager.sendEvent(QUESTION_UPDATED_EVENT, payload),
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
    for (const [sessionID] of this.sessionExecutionWaiters) {
      this.settleSessionExecutionWaiters(sessionID, { ok: false, error: "client stopped" })
    }
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
