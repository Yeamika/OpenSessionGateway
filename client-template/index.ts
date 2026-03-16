import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { OSGClient } from "@opensessiongateway/client-library";
import { handleServerEvent } from "./ServerEvent.js";
import { createMcpTemplates } from "./mcp.js";

const runtimeID = `run_${randomUUID()}`;
const baseUrl = process.env.OSG_BASE_URL || "http://127.0.0.1:4088/api/v2";
const wsServerUrl = baseUrl
  .replace(/^https:/i, "wss:")
  .replace(/^http:/i, "ws:")
  .replace(/\/+$/, "") + "/wsport";

const client = new OSGClient(
  {
    wsServerUrl,
    runtimeID,
    hostName: "client-template",
    logStream: process.stdout,
    WebSocketImpl: WebSocket as unknown as new (url: string) => any,
  },
  {
    showToast(type: string, message: string, subtitle?: string) {
      const line = subtitle ? `[toast:${type}] ${message}\n  subtitle: ${subtitle}` : `[toast:${type}] ${message}`;
      process.stderr.write(`${line}\n`);
    },
    async onServerEvent(message: unknown) {
      return handleServerEvent(message, runtimeID);
    },
  },
);

const templates = createMcpTemplates(wsServerUrl);
process.stderr.write(`[mcp] templates: ${JSON.stringify(templates)}\n`);

client.start();

process.on("SIGINT", () => {
  client.stop();
  process.exit(0);
});
