import process from "node:process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import WebSocket from "ws";

import { OSGClient } from "@opensessiongateway/client-library";
import { createClientContentExecuteingEnvelope, type ClientContentExecuteingPayload } from "@opensessiongateway/protocol-library";
import { handleServerEvent } from "./ServerEvent.js";
import { createTemplateRuntimeState } from "./runtime-state.js";

type JsonMap = Record<string, unknown>;

const CONNECT_TIMEOUT_MS = Number(process.env.OSG_TEST_CONNECT_TIMEOUT_MS || 10000);
const STEP_RETRY_MS = Number(process.env.OSG_TEST_RETRY_MS || 400);
const STEP_RETRY_COUNT = Number(process.env.OSG_TEST_RETRY_COUNT || 20);
const JSON_OUTPUT = process.env.OSG_SMOKE_JSON === "1";
const TEST_JSON_INLINE = process.env.OSG_TEST_JSON || "";
const TEST_JSON_FILE_RAW = process.env.OSG_TEST_JSON_FILE || "";
const TEST_JSON_MODE_RAW = process.env.OSG_TEST_JSON_MODE || "";

type ScenarioSurface = "runtime_control" | "session_bridge";

type ScenarioCall = {
  surface: ScenarioSurface;
  method: string;
  params?: Record<string, unknown>;
  query?: Record<string, string>;
  tool?: string;
  arguments?: Record<string, unknown>;
  repeat?: number;
  delayMs?: number;
};

type ScenarioConfig = {
  mode: "append" | "replace";
  calls: ScenarioCall[];
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function emit(level: "info" | "error", message: string, extra: Record<string, unknown> = {}) {
  if (JSON_OUTPUT) {
    process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), level, message, extra })}\n`);
    return;
  }
  if (level === "error") {
    process.stderr.write(`[osg-smoke] ${message}${Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : ""}\n`);
    return;
  }
  process.stdout.write(`[osg-smoke] ${message}${Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : ""}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toStringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    const normalized = text(raw);
    if (!normalized) continue;
    out[key] = normalized;
  }
  return out;
}

function normalizeScenarioMode(value: string): "append" | "replace" {
  return value.toLowerCase() === "replace" ? "replace" : "append";
}

function parseScenarioCallsFromLines(raw: string): unknown[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => JSON.parse(line));
}

function parseScenarioCalls(raw: string): { mode?: string; calls: unknown[] } {
  const input = raw.trim();
  if (!input) return { calls: [] };

  try {
    const parsed = JSON.parse(input);
    if (Array.isArray(parsed)) return { calls: parsed };
    if (isRecord(parsed) && Array.isArray(parsed.calls)) {
      return {
        mode: text(parsed.mode),
        calls: parsed.calls,
      };
    }
    throw new Error("scenario JSON must be an array or object with calls[]");
  } catch (error) {
    try {
      return { calls: parseScenarioCallsFromLines(input) };
    } catch {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`invalid scenario input: ${reason}`);
    }
  }
}

function normalizeScenarioCall(value: unknown): ScenarioCall | null {
  if (!isRecord(value)) return null;

  const surfaceRaw = text(value.surface).toLowerCase();
  const surface: ScenarioSurface | null =
    surfaceRaw === "runtime_control" || surfaceRaw === "session_bridge"
      ? (surfaceRaw as ScenarioSurface)
      : null;
  if (!surface) return null;

  const method = text(value.method);
  if (!method) return null;

  const repeatRaw = Number(value.repeat);
  const repeat = Number.isInteger(repeatRaw) && repeatRaw > 0 ? repeatRaw : 1;

  const delayRaw = Number(value.delayMs);
  const delayMs = Number.isFinite(delayRaw) && delayRaw > 0 ? Math.floor(delayRaw) : 0;

  const out: ScenarioCall = {
    surface,
    method,
    repeat,
    delayMs,
  };

  if (isRecord(value.params)) out.params = value.params;
  if (isRecord(value.arguments)) out.arguments = value.arguments;
  if (isRecord(value.query)) out.query = toStringMap(value.query);

  const tool = text(value.tool);
  if (tool) out.tool = tool;

  return out;
}

async function readScenarioConfig(): Promise<ScenarioConfig> {
  const inline = text(TEST_JSON_INLINE);
  const file = text(TEST_JSON_FILE_RAW);
  const fileContent = file
    ? await fs.readFile(path.resolve(process.cwd(), file), "utf8")
    : "";
  const source = inline || fileContent;

  if (!source) {
    return {
      mode: normalizeScenarioMode(TEST_JSON_MODE_RAW),
      calls: [],
    };
  }

  const parsed = parseScenarioCalls(source);
  const calls = parsed.calls
    .map((item) => normalizeScenarioCall(item))
    .filter((item): item is ScenarioCall => Boolean(item));

  return {
    mode: normalizeScenarioMode(parsed.mode || TEST_JSON_MODE_RAW),
    calls,
  };
}

function applyVars(value: unknown, vars: Record<string, string>): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (_full, key: string) => vars[key] || "");
  }
  if (Array.isArray(value)) return value.map((item) => applyVars(item, vars));
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value)) {
      out[key] = applyVars(raw, vars);
    }
    return out;
  }
  return value;
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

function healthUrlFromBaseV2(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}/api/health`;
}

let rpcSequence = 0;

async function rpc(
  endpoint: string,
  method: string,
  params?: Record<string, unknown>,
  query?: Record<string, string>,
) {
  const target = new URL(endpoint);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (!value) continue;
      target.searchParams.set(key, value);
    }
  }

  const payload: JsonMap = {
    jsonrpc: "2.0",
    id: ++rpcSequence,
    method,
  };
  if (params) payload.params = params;

  const response = await fetch(target, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const bodyText = await response.text();
  let body: JsonMap | null = null;
  if (bodyText) {
    try {
      body = JSON.parse(bodyText) as JsonMap;
    } catch {
      throw new Error(`invalid JSON from ${target.pathname}: ${bodyText.slice(0, 240)}`);
    }
  }

  if (!response.ok) {
    const detail = body && typeof body.error === "object" ? JSON.stringify(body.error) : bodyText;
    throw new Error(`HTTP ${response.status} ${target.pathname}: ${detail}`);
  }

  if (body && body.error && typeof body.error === "object") {
    const err = body.error as Record<string, unknown>;
    const code = typeof err.code === "number" ? err.code : -1;
    const message = typeof err.message === "string" ? err.message : "rpc error";
    throw new Error(`RPC ${method} failed (${code}): ${message}`);
  }

  return body && "result" in body ? body.result : null;
}

async function rpcToolsList(endpoint: string, query?: Record<string, string>) {
  const result = await rpc(endpoint, "tools/list", {}, query);
  const tools = result && typeof result === "object" && Array.isArray((result as Record<string, unknown>).tools)
    ? ((result as Record<string, unknown>).tools as Array<Record<string, unknown>>)
    : [];
  return tools
    .map((item) => (typeof item.name === "string" ? item.name : ""))
    .filter((name) => Boolean(name));
}

async function rpcToolCall(
  endpoint: string,
  toolName: string,
  args: Record<string, unknown>,
  query?: Record<string, string>,
) {
  const result = await rpc(endpoint, "tools/call", { name: toolName, arguments: args }, query);
  const content = result && typeof result === "object" ? (result as Record<string, unknown>).content : null;
  const first = Array.isArray(content) && content[0] && typeof content[0] === "object"
    ? (content[0] as Record<string, unknown>)
    : null;
  const textValue = first && typeof first.text === "string" ? first.text : "";
  assert(textValue, `tool ${toolName} returned empty text payload`);
  try {
    return JSON.parse(textValue) as JsonMap;
  } catch {
    throw new Error(`tool ${toolName} returned invalid JSON text: ${textValue.slice(0, 200)}`);
  }
}

async function withRetry<T>(
  name: string,
  fn: () => Promise<T>,
  checker: (value: T) => boolean,
): Promise<T> {
  let lastValue: T | null = null;
  for (let attempt = 1; attempt <= STEP_RETRY_COUNT; attempt += 1) {
    const value = await fn();
    lastValue = value;
    if (checker(value)) return value;
    await sleep(STEP_RETRY_MS);
  }
  throw new Error(`${name} not ready after ${STEP_RETRY_COUNT} attempts: ${JSON.stringify(lastValue).slice(0, 240)}`);
}

async function runScenarioCalls(input: {
  calls: ScenarioCall[];
  runtimeControlUrl: string;
  sessionBridgeUrl: string;
  runtimeID: string;
  createdSessionID: string;
}) {
  const vars: Record<string, string> = {
    runtimeID: input.runtimeID,
    createdSessionID: input.createdSessionID,
    cwd: process.cwd(),
  };

  for (let i = 0; i < input.calls.length; i += 1) {
    const call = input.calls[i];
    const endpoint = call.surface === "runtime_control" ? input.runtimeControlUrl : input.sessionBridgeUrl;
    const query = {
      ...(call.query || {}),
      ...(call.surface === "session_bridge" ? { runtimeID: call.query?.runtimeID || vars.runtimeID } : {}),
    };

    const title = `scenario ${i + 1}/${input.calls.length} ${call.surface}:${call.method}`;
    emit("info", "scenario-call-start", {
      index: i + 1,
      total: input.calls.length,
      surface: call.surface,
      method: call.method,
      repeat: call.repeat || 1,
    });

    for (let repeatIndex = 0; repeatIndex < (call.repeat || 1); repeatIndex += 1) {
      const paramsBase = isRecord(call.params) ? call.params : {};
      const paramsInterpolated = applyVars(paramsBase, vars);
      const params = isRecord(paramsInterpolated) ? (paramsInterpolated as Record<string, unknown>) : {};
      let result: unknown;

      if (call.method === "tools/call" && call.tool) {
        const toolName = text(applyVars(call.tool, vars));
        const toolArgs = isRecord(call.arguments)
          ? (applyVars(call.arguments, vars) as Record<string, unknown>)
          : ((params.arguments as Record<string, unknown> | undefined) || {});
        result = await rpcToolCall(endpoint, toolName, toolArgs, query);
      } else {
        result = await rpc(endpoint, call.method, params, query);
      }

      if (isRecord(result)) {
        const sessionID = text(result.sessionID);
        if (sessionID) vars.createdSessionID = sessionID;
        const runtimeID = text(result.runtimeID);
        if (runtimeID) vars.runtimeID = runtimeID;
      }

      if (call.delayMs && call.delayMs > 0) {
        await sleep(call.delayMs);
      }
    }

    emit("info", "scenario-call-ok", {
      index: i + 1,
      total: input.calls.length,
      title,
    });
  }
}

async function run() {
  const runtimeID = text(process.env.OSG_TEST_RUNTIME_ID) || `run_template_test_${randomUUID()}`;
  const baseV2 = baseV2Url();
  const wsServerUrl = wsServerUrlFromBaseV2(baseV2);
  const runtimeControlUrl = `${baseV2}/mcp/runtime_control`;
  const sessionBridgeUrl = `${baseV2}/mcp/session_bridge`;
  const healthUrl = healthUrlFromBaseV2(baseV2);

  const state = createTemplateRuntimeState({ runtimeID, cwd: process.cwd() });
  let client: OSGClient;

  const step = async (title: string, fn: () => Promise<void>) => {
    if (!JSON_OUTPUT) process.stdout.write(`[osg-smoke] ${title} ... `);
    if (JSON_OUTPUT) emit("info", "step-start", { title });
    await fn();
    if (!JSON_OUTPUT) process.stdout.write("ok\n");
    if (JSON_OUTPUT) emit("info", "step-ok", { title });
  };

  const reportClientContentExecuteing = (payload?: ClientContentExecuteingPayload, force = false) => {
    const envelope = payload
      ? createClientContentExecuteingEnvelope({ requestID: `content_${Date.now()}`, data: payload })
      : state.createClientContentExecuteingEnvelope(force);
    if (!envelope) return false;
    const sent = client.send(envelope);
    if (!sent) {
      emit("error", "failed to send ClientContentExecuteing", { runtimeID });
      return false;
    }
    return true;
  };

  client = new OSGClient(
    {
      wsServerUrl,
      runtimeID,
      hostName: "client-template-smoke",
      logStream: process.stdout,
      WebSocketImpl: WebSocket as unknown as new (url: string) => any,
      reconnectMs: 2000,
    },
    {
      onOpen() {
        reportClientContentExecuteing(undefined, true);
      },
      showToast() {
        // OSGLogger already emits the structured toast entry.
      },
      async onServerEvent(message: unknown) {
        return handleServerEvent(message, {
          state,
          reportClientContentExecuteing: (payload, force) => reportClientContentExecuteing(payload, force),
        });
      },
    },
  );

  let initialSessionID = state.getCurrentClientInfo().sessionID;
  let createdSessionID = "";
  const scenario = await readScenarioConfig();
  const runDefaultSuite = scenario.mode !== "replace" || scenario.calls.length === 0;
  if (scenario.calls.length > 0) {
    emit("info", "scenario-loaded", {
      mode: scenario.mode,
      calls: scenario.calls.length,
    });
  }

  try {
    await step("connect websocket runtime", async () => {
      client.start();
      const connected = await client.waitConnected(CONNECT_TIMEOUT_MS);
      assert(connected, `runtime did not receive connected ack within ${CONNECT_TIMEOUT_MS}ms`);
      reportClientContentExecuteing(undefined, true);
    });

    await step("health endpoint", async () => {
      const response = await fetch(healthUrl);
      assert(response.ok, `health request failed: ${response.status}`);
      const data = (await response.json()) as Record<string, unknown>;
      assert(data.healthy === true, `health payload is not healthy: ${JSON.stringify(data)}`);
    });

    if (runDefaultSuite) {
      await step("runtime_control tools list", async () => {
        const tools = await rpcToolsList(runtimeControlUrl);
        assert(tools.includes("ListRuntime"), "runtime_control missing ListRuntime");
        assert(tools.includes("CreateNewSession"), "runtime_control missing CreateNewSession");
        assert(tools.includes("AddPrompt"), "runtime_control missing AddPrompt");
        assert(tools.includes("ReloadClientInstanceWorkspace"), "runtime_control missing ReloadClientInstanceWorkspace");
        assert(tools.includes("ListRuntimeAvailableModels"), "runtime_control missing ListRuntimeAvailableModels");
      });

      await step("runtime visible in ListRuntime", async () => {
        await withRetry(
          "ListRuntime",
          () => rpcToolCall(runtimeControlUrl, "ListRuntime", { list: 200 }),
          (payload) => {
            const list = Array.isArray(payload.list) ? payload.list : [];
            return list.some((item) => item && typeof item === "object" && (item as Record<string, unknown>).runtimeID === runtimeID);
          },
        );
      });

      await step("CreateNewSession tool", async () => {
        const payload = await rpcToolCall(runtimeControlUrl, "CreateNewSession", {
          runtimeID,
          instanceWorkspaceDirectory: process.cwd(),
          content: "[template smoke] create new session",
          title: "Template Smoke Session",
        });
        assert(payload.ok === true, `CreateNewSession failed: ${JSON.stringify(payload)}`);
        assert(typeof payload.sessionID === "string" && payload.sessionID.trim(), "CreateNewSession returned empty sessionID");
        createdSessionID = String(payload.sessionID);
        const current = state.getCurrentClientInfo();
        assert(current.sessionID === createdSessionID, `CreateNewSession did not become active session: ${JSON.stringify(current)}`);
      });

      await step("SetClientDisplaySession tool", async () => {
        assert(initialSessionID, "missing initial sessionID for switch test");
        const payload = await rpcToolCall(runtimeControlUrl, "SetClientDisplaySession", {
          runtimeID,
          displayID: "display_smoke_switch",
          sessionID: initialSessionID,
          instanceWorkspaceDirectory: process.cwd(),
        });
        assert(payload.ok === true, `SetClientDisplaySession failed: ${JSON.stringify(payload)}`);
        assert(payload.sessionID === initialSessionID, `SetClientDisplaySession returned unexpected sessionID: ${JSON.stringify(payload)}`);
        const current = state.getCurrentClientInfo();
        assert(current.sessionID === initialSessionID, `SetClientDisplaySession did not switch active session: ${JSON.stringify(current)}`);
      });

      await step("session_bridge initialize", async () => {
        const result = await rpc(sessionBridgeUrl, "initialize", { runtimeID }, { runtimeID });
        const serverInfo = result && typeof result === "object" ? (result as Record<string, unknown>).serverInfo : null;
        const name = serverInfo && typeof serverInfo === "object" ? (serverInfo as Record<string, unknown>).name : "";
        assert(name === "session_bridge", `session_bridge initialize unexpected serverInfo: ${JSON.stringify(result)}`);
      });

      await step("session_bridge tools list", async () => {
        const tools = await rpcToolsList(sessionBridgeUrl, { runtimeID });
        assert(tools.includes("GetSessionMessages"), "session_bridge missing GetSessionMessages");
      });

      await step("AddPrompt tool", async () => {
        const payload = await rpcToolCall(
          runtimeControlUrl,
          "AddPrompt",
          {
            runtimeID,
            sessionID: createdSessionID,
            msg: "[template smoke] add prompt",
            role: "user",
          },
        );
        assert(payload.ok === true, `AddPrompt failed: ${JSON.stringify(payload)}`);
      });

      await step("GetSessionMessages includes prompt", async () => {
        await withRetry(
          "GetSessionMessages",
          () =>
            rpcToolCall(
              sessionBridgeUrl,
              "GetSessionMessages",
              {
                runtimeID,
                sessionID: createdSessionID,
                size: 20,
                regex: "template smoke",
              },
              { runtimeID },
            ),
          (payload) => Array.isArray(payload.list) && payload.list.length > 0,
        );
      });

      await step("ReloadClientInstanceWorkspace tool", async () => {
        const payload = await rpcToolCall(runtimeControlUrl, "ReloadClientInstanceWorkspace", {
          runtimeID,
          instanceWorkspaceDirectory: process.cwd(),
        });
        assert(payload.ok === true, `ReloadClientInstanceWorkspace failed: ${JSON.stringify(payload)}`);
        assert(payload.reloaded === true, `ReloadClientInstanceWorkspace did not report reloaded=true: ${JSON.stringify(payload)}`);
      });

      await step("ListActivedSessions includes created session", async () => {
        const payload = await rpcToolCall(runtimeControlUrl, "ListActivedSessions", {
          runtimeID,
          list: 50,
          regex: createdSessionID,
        });
        const list = Array.isArray(payload.list) ? payload.list : [];
        const matched = list.some((item) => item && typeof item === "object" && (item as Record<string, unknown>).id === createdSessionID);
        assert(matched, `ListActivedSessions missing ${createdSessionID}: ${JSON.stringify(payload)}`);
      });
    }

    if (scenario.calls.length > 0) {
      await step("scenario calls", async () => {
        await runScenarioCalls({
          calls: scenario.calls,
          runtimeControlUrl,
          sessionBridgeUrl,
          runtimeID,
          createdSessionID,
        });
      });
    }

    emit("info", "all checks passed", { runtimeID });
  } finally {
    client.stop();
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  emit("error", "failed", { message });
  process.exitCode = 1;
});
