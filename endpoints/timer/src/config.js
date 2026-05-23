import { readFile } from "node:fs/promises";

export const DEFAULT_CONFIG = Object.freeze({
  host: "127.0.0.1",
  port: 8789,
  gvRouterUrl: "",
  domain: "domain-a",
  runtimeID: "timer-endpoint",
  sessionID: "timer",
  sourceRuntime: "timer-endpoint",
  sourceSession: "timer",
  targetRuntime: "session-endpoint",
  targetSession: "",
  webExecutorRuntimeID: "timer-web",
  webExecutorSessionID: "timer-web",
});

export function parseArgs(argv) {
  const index = argv.indexOf("--config");
  return { configPath: index >= 0 ? argv[index + 1] || "" : "" };
}

export async function loadConfig(path = "") {
  if (!path) return { ...DEFAULT_CONFIG, configPath: "" };
  const raw = await readFile(path, "utf8");
  return { ...normalize(JSON.parse(raw)), configPath: path };
}

function normalize(input) {
  const listen = input.listen || {};
  const gv = input.gv || {};
  const web = input.webExecutor || {};
  return {
    ...DEFAULT_CONFIG,
    host: text(listen.host, DEFAULT_CONFIG.host),
    port: port(listen.port, DEFAULT_CONFIG.port),
    gvRouterUrl: text(gv.routerUrl, DEFAULT_CONFIG.gvRouterUrl),
    domain: text(gv.domain, DEFAULT_CONFIG.domain),
    runtimeID: text(gv.runtimeID, DEFAULT_CONFIG.runtimeID),
    sessionID: text(gv.sessionID, DEFAULT_CONFIG.sessionID),
    sourceRuntime: text(gv.sourceRuntime, text(gv.runtimeID, DEFAULT_CONFIG.sourceRuntime)),
    sourceSession: text(gv.sourceSession, text(gv.sessionID, DEFAULT_CONFIG.sourceSession)),
    targetRuntime: text(gv.targetRuntime, DEFAULT_CONFIG.targetRuntime),
    targetSession: text(gv.targetSession, DEFAULT_CONFIG.targetSession),
    webExecutorRuntimeID: text(web.runtimeID, DEFAULT_CONFIG.webExecutorRuntimeID),
    webExecutorSessionID: text(web.sessionID, DEFAULT_CONFIG.webExecutorSessionID),
  };
}

function text(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function port(value, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0 || number > 65535) return fallback;
  return number;
}
