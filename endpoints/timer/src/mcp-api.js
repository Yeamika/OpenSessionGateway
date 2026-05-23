const SELF_TOOLS = [
  tool("CreateOneShotTimer", ["ExecutorSessionID", "msg", "afterSeconds"], selfProps({ afterSeconds: "number" })),
  tool("CreatePeriodicTimer", ["ExecutorSessionID", "msg", "everySeconds"], selfProps({ everySeconds: "number" })),
  tool("CreateCronTimer", ["ExecutorSessionID", "msg", "cronExpr"], selfProps({ cronExpr: "string" })),
  tool("DeleteRuntimeTimer", ["ExecutorSessionID", "timerID"], selfProps({ timerID: "string" })),
  tool("ListRuntimeTimers", ["ExecutorSessionID"], selfProps()),
];

const MANAGER_TOOLS = [
  tool("CreateOneShotTimer", ["ExecutorSessionID", "runtimeID", "sessionID", "msg", "afterSeconds"], managerProps({ afterSeconds: "number" })),
  tool("CreatePeriodicTimer", ["ExecutorSessionID", "runtimeID", "sessionID", "msg", "everySeconds"], managerProps({ everySeconds: "number" })),
  tool("CreateCronTimer", ["ExecutorSessionID", "runtimeID", "sessionID", "msg", "cronExpr"], managerProps({ cronExpr: "string" })),
  tool("DeleteRuntimeTimer", ["ExecutorSessionID", "runtimeID", "sessionID", "timerID"], managerProps({ timerID: "string" })),
  tool("ListRuntimeTimers", ["ExecutorSessionID", "runtimeID", "sessionID"], managerProps()),
  tool("ListAllTimers", ["ExecutorSessionID"], executorProps()),
  tool("ReloadConfig", ["ExecutorSessionID"], executorProps()),
];

export async function handleMcp({ timers, scope, runtimeID, body, reloadConfig }) {
  const id = body?.id ?? null;
  const method = String(body?.method || "");
  const params = body?.params || {};
  if (method === "initialize") return ok(id, { protocolVersion: "2025-03-26", serverInfo: { name: `timer_${scope}`, version: "0.1.0" }, capabilities: { tools: { listChanged: false } } });
  if (method === "tools/list") return ok(id, { tools: scope === "self" ? SELF_TOOLS : MANAGER_TOOLS });
  if (method !== "tools/call") return err(id, -32601, `method not found: ${method}`);
  try {
    return ok(id, textResult(await callTool({ timers, scope, runtimeID, name: params.name, args: params.arguments || {}, reloadConfig })));
  } catch (error) {
    return err(id, -32602, error instanceof Error ? error.message : String(error));
  }
}

export async function callTool({ timers, scope, runtimeID, name, args, reloadConfig }) {
  if (name === "ReloadConfig") {
    normalizeExecutor(scope, runtimeID, args);
    if (!reloadConfig) throw new Error("ReloadConfig is not available in this context");
    return { ok: true, config: await reloadConfig() };
  }
  if (name === "ListAllTimers") {
    const audit = normalizeExecutor(scope, runtimeID, args);
    const list = timers.list();
    return { realsize: list.length, list, executor: audit };
  }
  const normalized = normalizeArgs(scope, runtimeID, args);
  if (name === "ListRuntimeTimers") {
    const list = timers.list(normalized);
    return { realsize: list.length, list };
  }
  if (name === "DeleteRuntimeTimer") return timers.deleteTimer(normalized);
  if (name === "CreateOneShotTimer") return timers.create({ ...normalized, timerType: "one_shot", afterSeconds: args.afterSeconds });
  if (name === "CreatePeriodicTimer") return timers.create({ ...normalized, timerType: "periodic", everySeconds: args.everySeconds });
  if (name === "CreateCronTimer") return timers.create({ ...normalized, timerType: "cron", cronExpr: args.cronExpr });
  throw new Error(`unknown tool: ${name || "<empty>"}`);
}

function normalizeArgs(scope, runtimeID, args) {
  const executor = normalizeExecutor(scope, runtimeID, args);
  const base = scope === "self"
    ? { runtimeID: requireText(runtimeID, "runtimeID"), sessionID: executor.ExecutorSessionID }
    : { runtimeID: requireText(args.runtimeID, "runtimeID"), sessionID: requireText(args.sessionID, "sessionID") };
  return { ...base, ...executor, title: String(args.title || "").trim(), msg: String(args.msg || "").trim(), timerID: String(args.timerID || "").trim() };
}

function normalizeExecutor(scope, runtimeID, args) {
  return {
    ExecutorRuntimeID: String(args.ExecutorRuntimeID || (scope === "self" ? runtimeID : "")).trim(),
    ExecutorSessionID: requireText(args.ExecutorSessionID, "ExecutorSessionID"),
  };
}

function tool(name, required, properties) {
  return { name, description: name, inputSchema: { type: "object", properties, required, additionalProperties: false } };
}

function executorProps() {
  return {
    ExecutorRuntimeID: { type: "string", description: "Optional caller/executor runtimeID for audit" },
    ExecutorSessionID: { type: "string", description: "Caller/executor sessionID for audit and ownership" },
  };
}

function selfProps(extra = {}) {
  return { ...executorProps(), ...optionalCommon(), ...typedProps(extra) };
}

function managerProps(extra = {}) {
  return {
    ...executorProps(),
    runtimeID: { type: "string", description: "Target runtimeID" },
    sessionID: { type: "string", description: "Target sessionID, distinct from ExecutorSessionID" },
    ...optionalCommon(),
    ...typedProps(extra),
  };
}

function optionalCommon() {
  return {
    title: { type: "string", description: "Optional timer title" },
    msg: { type: "string", description: "Timer message" },
  };
}

function typedProps(input) {
  return Object.fromEntries(Object.entries(input).map(([key, type]) => [key, { type }]));
}

function textResult(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function ok(id, result) { return { jsonrpc: "2.0", id, result }; }
function err(id, code, message) { return { jsonrpc: "2.0", id, error: { code, message } }; }
function requireText(value, name) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${name} is required`);
  return text;
}
