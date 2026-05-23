import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { callTool, handleMcp } from "./mcp-api.js";
import { timerToolEnvelope } from "./osgp-wire.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const webRoot = join(root, "web");

export function createHttpServer({ configManager, gv, timers }) {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      if (req.method === "GET" && url.pathname === "/api/status") return json(res, { config: publicConfig(configManager.get()), gv: gv.state() });
      if (req.method === "POST" && url.pathname === "/api/config/reload") return json(res, { config: publicConfig(await configManager.reload()), gv: gv.state() });
      if (url.pathname === "/api/timers") return handleTimerApi(req, res, { config: configManager.get(), timers, url });
      if (url.pathname.startsWith("/mcp/")) return handleMcpApi(req, res, { timers, url, configManager });
      return serveStatic(req, res, url.pathname);
    } catch (error) {
      return json(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });
}

async function handleTimerApi(req, res, ctx) {
  if (req.method === "GET") {
    const runtimeID = ctx.url.searchParams.get("runtimeID") || "";
    const sessionID = ctx.url.searchParams.get("sessionID") || "";
    return json(res, { list: ctx.timers.list({ runtimeID, sessionID }) });
  }
  const body = await readJson(req);
  const args = withWebExecutor(ctx.config, body.arguments || {});
  const envelope = timerToolEnvelope(ctx.config, body.tool, args, body.tool?.startsWith("List") ? "request" : "control");
  const result = await callTool({ timers: ctx.timers, scope: "manager", runtimeID: ctx.config.runtimeID, name: body.tool, args });
  return json(res, { result, envelope });
}

async function handleMcpApi(req, res, { timers, url, configManager }) {
  if (req.method !== "POST") return json(res, { error: "POST required" }, 405);
  const scope = url.pathname.endsWith("timer_scheduler") ? "self" : "manager";
  const result = await handleMcp({ timers, scope, runtimeID: url.searchParams.get("runtimeID") || "", body: await readJson(req), reloadConfig: () => configManager.reload() });
  return json(res, result, result.error ? 400 : 200);
}

function serveStatic(req, res, pathname) {
  if (req.method !== "GET") return json(res, { error: "method not allowed" }, 405);
  const safe = normalize(pathname).replace(/^([/\\])+/, "");
  const file = join(webRoot, safe || "index.html");
  const target = existsSync(file) && !file.endsWith("/") ? file : join(webRoot, "index.html");
  res.writeHead(200, { "content-type": mime(target) });
  createReadStream(target).pipe(res);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function json(res, data, status = 200) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data, null, 2));
}

function publicConfig(config) {
  return { runtimeID: config.runtimeID, sessionID: config.sessionID, domain: config.domain, gvRouterUrl: config.gvRouterUrl, webExecutorRuntimeID: config.webExecutorRuntimeID, webExecutorSessionID: config.webExecutorSessionID };
}

function withWebExecutor(config, args) {
  return {
    ExecutorRuntimeID: config.webExecutorRuntimeID,
    ExecutorSessionID: config.webExecutorSessionID,
    ...args,
  };
}

function mime(file) {
  return { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" }[extname(file)] || "application/octet-stream";
}
