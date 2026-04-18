import process from "node:process";
import { randomUUID } from "node:crypto";
import readline from "node:readline";
import WebSocket from "ws";

import { OSGClient } from "@opensessiongateway/client-library";
import { createClientContentExecuteingEnvelope, type ClientContentExecuteingPayload } from "@opensessiongateway/protocol-library";
import { handleServerEvent } from "./ServerEvent.js";
import { createTemplateRuntimeState } from "./runtime-state.js";

type JsonMap = Record<string, unknown>;

type Command = {
  id?: string | number;
  op?: string;
  args?: Record<string, unknown>;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function baseV2Url(): string {
  const source = text(process.env.OSG_BASE_URL) || "http://127.0.0.1:4088/api/v2";
  const trimmed = source.replace(/\/+$/, "");
  if (trimmed.endsWith("/api/v2")) return trimmed;
  if (trimmed.endsWith("/api")) return `${trimmed}/v2`;
  if (trimmed.endsWith("/v2")) return `${trimmed.startsWith("http") ? trimmed : `http://${trimmed}`}`;
  return `${trimmed}/api/v2`;
}

function wsServerUrlFromBaseV2(url: string): string {
  return url
    .replace(/^https:/i, "wss:")
    .replace(/^http:/i, "ws:")
    .replace(/\/+$/, "") + "/wsport";
}

function normalizeOp(raw: unknown): string {
  return text(raw).toLowerCase().replace(/[^a-z0-9_]/g, "");
}

function emitEvent(event: string, payload: Record<string, unknown> = {}) {
  process.stdout.write(`${JSON.stringify({ channel: "event", event, ...payload })}\n`);
}

function emitResponse(id: string | number | null, ok: boolean, result?: unknown, error?: string) {
  process.stdout.write(
    `${JSON.stringify({
      channel: "response",
      id,
      ok,
      ...(ok ? { result: result ?? null } : { error: error || "unknown error" }),
    })}\n`,
  );
}

async function run() {
  const runtimeID = text(process.env.OSG_RUNTIME_ID) || `run_${randomUUID()}`;
  const hostName = text(process.env.OSG_HOST_NAME) || "client-template-script";
  const baseV2 = baseV2Url();
  const wsServerUrl = wsServerUrlFromBaseV2(baseV2);
  const bootstrap = process.env.OSG_TEMPLATE_DISABLE_BOOTSTRAP !== "1";

  const state = createTemplateRuntimeState({ runtimeID, cwd: process.cwd(), bootstrap });
  let client: OSGClient;

  const reportClientContentExecuteing = (payload?: ClientContentExecuteingPayload, force = false) => {
    const envelope = payload
      ? createClientContentExecuteingEnvelope({ requestID: `content_${Date.now()}`, data: payload })
      : state.createClientContentExecuteingEnvelope(force);
    if (!envelope) return false;
    const sent = client.send(envelope);
    if (!sent) {
      client.logger.warn("script-control report ClientContentExecuteing failed", {
        runtimeID,
      });
      return false;
    }
    return true;
  };

  client = new OSGClient(
    {
      wsServerUrl,
      runtimeID,
      hostName,
      logStream: process.stderr,
      WebSocketImpl: WebSocket as unknown as new (url: string) => any,
      reconnectMs: 2000,
    },
    {
      onOpen() {
        reportClientContentExecuteing(undefined, true);
        emitEvent("ws_connected", { runtimeID });
      },
      onClose(event) {
        emitEvent("ws_closed", {
          code: typeof event?.code === "number" ? event.code : null,
          reason: typeof event?.reason === "string" ? event.reason : "",
        });
      },
      showToast() {
      },
      async onServerEvent(message: unknown) {
        return handleServerEvent(message, {
          state,
          reportClientContentExecuteing: (payload, force) => reportClientContentExecuteing(payload, force),
          writeLog(level, messageText, extra = {}) {
            if (level === "error") {
              client.logger.error(messageText, extra);
              return;
            }
            if (level === "warn") {
              client.logger.warn(messageText, extra);
              return;
            }
            client.logger.info(messageText, extra);
          },
        });
      },
    },
  );

  const mutatingOps = new Set([
    "createnewsession",
    "addpromot",
    "renamesessionofclient",
    "setclientdisplaysession",
    "abortsessionofclient",
      "requestinstanceworkspacereload",
  ]);

  async function execute(command: Command): Promise<unknown> {
    const op = normalizeOp(command.op);
    const args = command.args && typeof command.args === "object" ? command.args : {};

    if (op === "ping") {
      return { pong: true, runtimeID };
    }
    if (op === "waitconnected") {
      const timeoutMsRaw = Number((args as JsonMap).timeoutMs);
      const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? Math.floor(timeoutMsRaw) : 8000;
      const connected = await client.waitConnected(timeoutMs);
      return { connected, timeoutMs };
    }
    if (op === "getcurrentclientinfo" || op === "currentinfo") {
      return state.getCurrentClientInfo();
    }
    if (op === "listsession") {
      return state.listSession(args as { list?: number; regex?: string });
    }
    if (op === "listavailablemodels") {
      return state.listAvailableModels(args as { list?: number; regex?: string });
    }
    if (op === "listlastusedmodelofsession") {
      return state.listLastUsedModelOfSession(args as { sessionID?: string });
    }
    if (op === "getsessionmsg") {
      return state.getSessionMsg(args as { sessionID?: string; size?: number; regex?: string });
    }
    if (op === "createnewsession") {
      return state.createNewSession(args as { instanceWorkspaceDirectory?: string; content?: string; title?: string; model?: string; displayID?: string });
    }
    if (op === "addpromot") {
      return state.addPromot(args as { sessionID?: string; msg?: string; model?: string; system?: string });
    }
    if (op === "renamesessionofclient") {
      return state.renameSessionOfClient(args as { sessionID?: string; title?: string });
    }
    if (op === "setclientdisplaysession") {
      return state.setClientDisplaySession(args as { displayID?: string; sessionID?: string });
    }
    if (op === "abortsessionofclient") {
      return state.abortSessionOfClient(args as { sessionID?: string });
    }
    if (op === "requestinstanceworkspacereload") {
      return state.requestInstanceWorkspaceReload(args as { instanceWorkspaceDirectory?: string; title?: string });
    }
    if (op === "emitclientcontent" || op === "report") {
      reportClientContentExecuteing(undefined, true);
      return { reported: true };
    }
    if (op === "shutdown" || op === "stop") {
      return { shuttingDown: true };
    }

    throw new Error(`unknown op: ${String(command.op || "")}`);
  }

  client.start();
  emitEvent("ready", { runtimeID, hostName, wsServerUrl });

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

  for await (const line of rl) {
    const raw = line.trim();
    if (!raw) continue;

    let command: Command;
    try {
      command = JSON.parse(raw) as Command;
    } catch {
      emitResponse(null, false, null, "invalid json line");
      continue;
    }

    const id = typeof command.id === "string" || typeof command.id === "number" ? command.id : null;
    const op = normalizeOp(command.op);

    try {
      const result = await execute(command);
      emitResponse(id, true, result);

      if (mutatingOps.has(op)) {
        const src = result && typeof result === "object" ? (result as JsonMap) : {};
        if (src.ok !== false) {
          reportClientContentExecuteing();
        }
      }

      if (op === "shutdown" || op === "stop") {
        break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emitResponse(id, false, null, message);
    }
  }

  rl.close();
  client.stop();
  emitEvent("stopped", { runtimeID });
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stdout.write(`${JSON.stringify({ channel: "event", event: "fatal", message })}\n`);
  process.exitCode = 1;
});
