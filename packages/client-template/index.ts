import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { OSGClient } from "@opensessiongateway/client-library";
import { createClientContentExecuteingEnvelope, type ClientContentExecuteingPayload } from "@opensessiongateway/protocol-library";
import { handleServerEvent } from "./ServerEvent.js";
import { createMcpTemplates } from "./mcp.js";
import { createTemplateRuntimeState } from "./runtime-state.js";

const runtimeID = process.env.OSG_RUNTIME_ID || `run_${randomUUID()}`;
const baseUrl = process.env.OSG_BASE_URL || "http://127.0.0.1:4088/api/v2";
const hostName = process.env.OSG_HOST_NAME || "client-template";
const bootstrap = process.env.OSG_TEMPLATE_DISABLE_BOOTSTRAP !== "1";
const wsServerUrl = baseUrl
  .replace(/^https:/i, "wss:")
  .replace(/^http:/i, "ws:")
  .replace(/\/+$/, "") + "/wsport";

const state = createTemplateRuntimeState({
  runtimeID,
  cwd: process.cwd(),
  bootstrap,
});

let client: OSGClient;

function reportClientContentExecuteing(payload?: ClientContentExecuteingPayload, force = false) {
  const envelope = payload
    ? createClientContentExecuteingEnvelope({ requestID: `content_${Date.now()}`, data: payload })
    : state.createClientContentExecuteingEnvelope(force);
  if (!envelope) return false;
  const sent = client.send(envelope);
  if (!sent) {
    client.logger.warn("report ClientContentExecuteing failed", {
      runtimeID,
      hostName,
    });
    return false;
  }
  return true;
}

client = new OSGClient(
  {
    wsServerUrl,
    runtimeID,
    hostName,
    logStream: process.stdout,
    WebSocketImpl: WebSocket as unknown as new (url: string) => any,
  },
  {
    onOpen() {
      reportClientContentExecuteing(undefined, true);
    },
    showToast() {
      // OSGLogger already records structured toast logs.
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

const templates = createMcpTemplates(wsServerUrl);
client.logger.info("template runtime", {
  runtimeID,
  hostName,
  wsServerUrl,
});
client.logger.info("mcp templates", {
  templates,
});

client.start();

process.on("SIGINT", () => {
  client.stop();
  process.exit(0);
});
