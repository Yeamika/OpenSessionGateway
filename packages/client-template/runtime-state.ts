import fs from "node:fs";
import path from "node:path";
import {
  createAbortSessionRequest,
  createAddPromotRequest,
  createClientContentExecuteingEnvelope,
  createClientContentExecuteingPayload,
  createGetSessionMsgRequest,
  createListAvailableModelsRequest,
  createListSessionRequestPayload,
  createNewSessionRequest,
  createRequestRuntimePayload,
  readResolvePermissionRequestPayload,
  createRenameSessionRequest,
  createSetClientDisplaySessionRequest,
} from "@opensessiongateway/protocol-library";

type SessionStatus = "idle" | "busy" | "error";

type TemplateMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  time: string;
};

type ModelRef = {
  providerID: string;
  modelID: string;
  id: string;
  name: string;
};

type TemplateSession = {
  id: string;
  title: string;
  status: SessionStatus;
  instanceWorkspaceDirectory: string;
  displayID: string | null;
  messages: TemplateMessage[];
  createdAt: number;
  updatedAt: number;
  lastUsedModel: ModelRef;
  lastUsedAt: string;
};

type SessionListInput = { list?: number; regex?: string };
type ModelListInput = { list?: number; regex?: string };
type SessionMsgInput = { sessionID?: string; size?: number; regex?: string };
type ReloadInput = { instanceWorkspaceDirectory?: string; title?: string };

type RuntimeStateInput = {
  runtimeID: string;
  cwd: string;
  bootstrap?: boolean;
};

const MODELS: ModelRef[] = [
  { providerID: "openai", modelID: "gpt-4.1-mini", id: "openai/gpt-4.1-mini", name: "GPT-4.1 Mini" },
  { providerID: "anthropic", modelID: "claude-3-5-sonnet", id: "anthropic/claude-3-5-sonnet", name: "Claude 3.5 Sonnet" },
  { providerID: "google", modelID: "gemini-2.0-flash", id: "google/gemini-2.0-flash", name: "Gemini 2.0 Flash" },
];

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nowIso(): string {
  return new Date().toISOString();
}

function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

function parseRegex(input: unknown): RegExp | null {
  const source = text(input);
  if (!source) return null;
  try {
    return new RegExp(source, "i");
  } catch {
    return null;
  }
}

function parseModel(value: string | undefined): ModelRef {
  const source = text(value);
  if (!source) return MODELS[0];
  const slash = source.indexOf("/");
  if (slash <= 0 || slash >= source.length - 1) return MODELS[0];
  const providerID = source.slice(0, slash).trim();
  const modelID = source.slice(slash + 1).trim();
  if (!providerID || !modelID) return MODELS[0];
  return {
    providerID,
    modelID,
    id: `${providerID}/${modelID}`,
    name: modelID,
  };
}

function mapStatusForCurrentInfo(status: SessionStatus): string {
  if (status === "idle") return "Idle";
  if (status === "busy") return "Busy";
  return "Interrupted";
}

function mapSessionState(status: SessionStatus): "idle" | "busy" | "stopped" {
  if (status === "idle") return "idle";
  if (status === "busy") return "busy";
  return "stopped";
}

function mapSessionReason(status: SessionStatus): "completed" | "generating" | "error" {
  if (status === "idle") return "completed";
  if (status === "busy") return "generating";
  return "error";
}

function mapStatusForSessionMsg(status: SessionStatus): "busy" | "idle" | "interrupted" {
  if (status === "busy") return "busy";
  if (status === "error") return "interrupted";
  return "idle";
}

function createMessage(role: TemplateMessage["role"], content: string): TemplateMessage {
  return {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    time: nowIso(),
  };
}

function createSession(input: {
  directory: string;
  title: string;
  displayID?: string;
  model?: string;
  initialContent?: string;
}): TemplateSession {
  const createdAt = Date.now();
  const directory = path.resolve(input.directory);
  const sessionID = `ses_template_${createdAt}_${Math.random().toString(36).slice(2, 6)}`;
  const model = parseModel(input.model);
  const messages: TemplateMessage[] = [];
  if (text(input.initialContent)) {
    messages.push(createMessage("user", input.initialContent as string));
  }

  return {
    id: sessionID,
    title: text(input.title) || "Template Session",
    status: "idle",
    instanceWorkspaceDirectory: directory,
    displayID: text(input.displayID) || null,
    messages,
    createdAt,
    updatedAt: createdAt,
    lastUsedModel: model,
    lastUsedAt: nowIso(),
  };
}

export function createTemplateRuntimeState(input: RuntimeStateInput) {
  const runtimeID = text(input.runtimeID);
  let cwd = path.resolve(text(input.cwd) || process.cwd());
  const sessions = new Map<string, TemplateSession>();
  let currentSessionID = "";
  let currentDisplayID = "display_template";
  let lastContentKey = "";
  let contentSequence = 0;

  if (input.bootstrap !== false) {
    const bootstrap = createSession({
      directory: cwd,
      title: "Template Demo Session",
      displayID: currentDisplayID,
    });
    sessions.set(bootstrap.id, bootstrap);
    currentSessionID = bootstrap.id;
  }

  function activeSession(): TemplateSession | null {
    if (currentSessionID && sessions.has(currentSessionID)) {
      return sessions.get(currentSessionID) || null;
    }
    const first = sessions.values().next();
    return first.done ? null : first.value;
  }

  function touchSession(session: TemplateSession) {
    session.updatedAt = Date.now();
  }

  function reportSession(session: TemplateSession | null) {
    return createClientContentExecuteingPayload({
      displayID: currentDisplayID || undefined,
      instanceWorkspaceDirectory: cwd || undefined,
      session: session
        ? {
            sessionID: session.id,
            title: session.title,
            state: mapSessionState(session.status),
            reason: mapSessionReason(session.status),
          }
        : undefined,
    });
  }

  return {
    getCurrentClientInfo() {
      const current = activeSession();
      return {
        runtimeID,
        sessionID: current?.id || "",
        sessionTitle: current?.title || "",
        status: current ? mapStatusForCurrentInfo(current.status) : "Idle",
        cwd,
      };
    },

    listSession(payload?: SessionListInput) {
      const req = createListSessionRequestPayload(payload || {});
      const regex = parseRegex(req.regex);
      const rows = [...sessions.values()]
        .filter((item) => {
          if (!regex) return true;
          return regex.test(item.id) || regex.test(item.title) || regex.test(item.instanceWorkspaceDirectory);
        })
        .sort((a, b) => b.updatedAt - a.updatedAt);

      return {
        meta: { matched: rows.length },
        sessions: rows.slice(0, req.list).map((item) => ({
          id: item.id,
          title: item.title,
          status: mapStatusForCurrentInfo(item.status),
          time: new Date(item.updatedAt).toISOString(),
        })),
      };
    },

    listAvailableModels(payload?: ModelListInput) {
      const req = createListAvailableModelsRequest(payload || {});
      const regex = parseRegex(req.regex);
      const rows = MODELS.filter((item) => {
        if (!regex) return true;
        return regex.test(item.id) || regex.test(item.name) || regex.test(item.providerID) || regex.test(item.modelID);
      });
      return {
        realsize: rows.length,
        list: rows.slice(0, req.list),
      };
    },

    listLastUsedModelOfSession(payload?: { sessionID?: string }) {
      const sessionID = text(payload?.sessionID) || activeSession()?.id || "";
      const session = sessionID ? sessions.get(sessionID) || null : null;
      const model = session?.lastUsedModel || MODELS[0];
      return {
        runtimeID,
        sessionID,
        providerID: model.providerID,
        modelID: model.modelID,
        id: model.id,
        time: session?.lastUsedAt || "",
      };
    },

    getSessionMsg(payload?: SessionMsgInput) {
      const req = createGetSessionMsgRequest(payload || {});
      const session = (req.sessionID ? sessions.get(req.sessionID) : activeSession()) || null;
      if (!session) {
        return {
          runtimeID,
          sessionID: req.sessionID,
          realsize: 0,
          list: [],
          status: "interrupted" as const,
          error: "session not found",
        };
      }
      const regex = parseRegex(req.regex);
      const matched = session.messages.filter((item) => {
        if (!regex) return true;
        return regex.test(item.role) || regex.test(item.content) || regex.test(item.time);
      });
      const list = matched.length > req.size ? matched.slice(matched.length - req.size) : matched;

      return {
        runtimeID,
        sessionID: session.id,
        realsize: matched.length,
        list,
        status: mapStatusForSessionMsg(session.status),
      };
    },

    renameSessionOfClient(payload?: { sessionID?: string; title?: string }) {
      const req = createRenameSessionRequest(payload || {});
      const session = sessions.get(req.sessionID);
      if (!session) {
        return { ok: false, sessionID: req.sessionID, title: req.title, error: "session not found" };
      }
      if (!req.title) {
        return { ok: false, sessionID: req.sessionID, title: req.title, error: "title is required" };
      }

      session.title = req.title;
      touchSession(session);
      return { ok: true, sessionID: session.id, title: session.title };
    },

    setClientDisplaySession(payload?: { displayID?: string; sessionID?: string }) {
      const req = createSetClientDisplaySessionRequest(payload || {});
      const session = sessions.get(req.sessionID);
      if (!session) {
        return { ok: false, displayID: req.displayID, sessionID: req.sessionID, error: "session not found" };
      }
      if (!req.displayID) {
        return { ok: false, displayID: req.displayID, sessionID: req.sessionID, error: "displayID is required" };
      }

      currentDisplayID = req.displayID;
      currentSessionID = session.id;
      session.displayID = req.displayID;
      touchSession(session);
      return { ok: true, displayID: req.displayID, sessionID: session.id };
    },

    abortSessionOfClient(payload?: { sessionID?: string }) {
      const req = createAbortSessionRequest(payload || {});
      const session = sessions.get(req.sessionID);
      if (!session) {
        return { ok: false, aborted: false, sessionID: req.sessionID, error: "session not found" };
      }

      session.status = "error";
      session.messages.push(createMessage("system", "[template] session aborted"));
      touchSession(session);
      return { ok: true, aborted: true, sessionID: session.id };
    },

    addPromot(payload?: { sessionID?: string; msg?: string; model?: string; system?: string }) {
      const req = createAddPromotRequest(payload || {});
      if (!req.msg) {
        return { ok: false, model: req.model || null, sessionID: req.sessionID, error: "msg is required" };
      }

      let session = req.sessionID ? sessions.get(req.sessionID) || null : activeSession();
      if (!session) {
        session = createSession({
          directory: cwd,
          title: `Template Session ${sessions.size + 1}`,
          displayID: currentDisplayID,
        });
        sessions.set(session.id, session);
      }

      session.status = "busy";
      session.messages.push(createMessage("user", req.msg));
      if (req.system) {
        session.messages.push(createMessage("system", `[template system] ${req.system}`));
      }
      session.messages.push(createMessage("assistant", `[template ack] received user prompt`));
      session.status = "idle";
      session.lastUsedModel = parseModel(req.model);
      session.lastUsedAt = nowIso();
      touchSession(session);

      currentSessionID = session.id;
      return {
        ok: true,
        model: req.model || null,
        sessionID: session.id,
      };
    },

    createNewSession(payload?: {
      instanceWorkspaceDirectory?: string;
      content?: string;
      title?: string;
      model?: string;
      displayID?: string;
    }) {
      const req = createNewSessionRequest(payload || {});
      if (!req.instanceWorkspaceDirectory) {
        return { ok: false, sessionID: "", content: req.content, error: "instanceWorkspaceDirectory is required" };
      }
      if (!text(req.content)) {
        return {
          ok: false,
          sessionID: "",
          content: req.content,
          title: req.title,
          model: req.model,
          displayID: req.displayID,
          error: "content is required",
        };
      }

      const session = createSession({
        directory: req.instanceWorkspaceDirectory,
        title: req.title || `Template Session ${sessions.size + 1}`,
        displayID: req.displayID || currentDisplayID,
        model: req.model,
        initialContent: req.content,
      });
      sessions.set(session.id, session);
      currentSessionID = session.id;
      currentDisplayID = req.displayID || currentDisplayID;
      cwd = session.instanceWorkspaceDirectory;

      return {
        ok: true,
        sessionID: session.id,
        content: req.content,
        title: session.title,
        model: req.model,
        displayID: req.displayID || undefined,
        session: {
          id: session.id,
          title: session.title,
          time: {
            created: session.createdAt,
            updated: session.updatedAt,
          },
        },
      };
    },

    requestInstanceWorkspaceReload(payload?: ReloadInput) {
      const requestedDirectory = text(payload?.instanceWorkspaceDirectory);
      const directory = path.resolve(requestedDirectory || cwd || process.cwd());

      cwd = directory;
      const current = activeSession();
      if (current) {
        current.instanceWorkspaceDirectory = directory;
        touchSession(current);
      }

      return {
        ok: true,
        reloaded: true,
        instanceWorkspaceDirectory: directory,
        title: text(payload?.title) || path.basename(directory),
      };
    },

    requestRuntime(payload?: { sessionID?: string }) {
      const req = createRequestRuntimePayload(payload || {});
      if (!req.sessionID) {
        return {
          response: {
            ok: false,
            runtimeID,
            synced: false,
            session: { requested: true, exists: false, sessionID: "" },
            error: "RequestRuntime requires sessionID",
          },
          reportPayload: null,
        };
      }

      const session = req.sessionID ? sessions.get(req.sessionID) || null : null;
      const reportPayload = session
        ? createClientContentExecuteingPayload({
            displayID: session.displayID || currentDisplayID || undefined,
            instanceWorkspaceDirectory: session.instanceWorkspaceDirectory,
            session: {
              sessionID: session.id,
              title: session.title,
              state: mapSessionState(session.status),
              reason: mapSessionReason(session.status),
            },
          })
        : null;

      return {
        response: {
          ok: true,
          runtimeID,
          synced: false,
          ...(req.sessionID ? {
            session: {
              requested: true,
              exists: Boolean(session),
              sessionID: req.sessionID,
              title: session?.title || undefined,
              state: session ? mapSessionState(session.status) : null,
              reason: session ? mapSessionReason(session.status) : null,
              meta: null,
              displayID: session?.displayID || null,
            },
          } : {}),
        },
        reportPayload,
      };
    },

    resolvePermissionRequest(payload?: {
      permissionID?: string;
      action?: "approve" | "deny" | "cancel";
      reason?: string;
      actor?: string;
      correlationID?: string;
    }) {
      const req = readResolvePermissionRequestPayload(payload || {});
      return {
        ok: true,
        permissionID: req.permissionID,
        action: req.action,
      };
    },

    createClientContentExecuteingEnvelope(force = false) {
      const payload = reportSession(activeSession());
      const key = JSON.stringify(payload);
      if (!force && key === lastContentKey) return null;

      lastContentKey = key;
      contentSequence += 1;
      return createClientContentExecuteingEnvelope({
        requestID: `content_${Date.now()}_${contentSequence}`,
        data: payload,
      });
    },
  };
}

function fsExists(directory: string): boolean {
  try {
    return fs.existsSync(path.isAbsolute(directory) ? directory : path.resolve(directory));
  } catch {
    return false;
  }
}

export type TemplateRuntimeState = ReturnType<typeof createTemplateRuntimeState>;
