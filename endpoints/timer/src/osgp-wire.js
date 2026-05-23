let nextId = 1;

export function address(domain, runtime, session) {
  const out = { domain };
  if (runtime) out.runtime = runtime;
  if (session) out.session = session;
  return out;
}

export function hello(config) {
  return {
    nodeId: config.runtimeID,
    role: "endpoint",
    addresses: [address(config.domain, config.runtimeID, config.sessionID)],
    capabilities: ["timer_endpoint", "timer_mcp", "timer_web"],
  };
}

export function timerFiredEnvelope(config, timer) {
  return envelope(config, "control", "timer.fired", {
    timer,
    prompt: {
      msg: "[OSG-Timer-Triggered]",
      system: timerSystemPrompt(timer),
    },
  });
}

export function timerToolEnvelope(config, tool, args, linkType = "request") {
  return envelope(config, linkType, toolToSubtype(tool), { tool, arguments: args });
}

export function responseEnvelope(config, request, result, error) {
  return {
    type: "envelope",
    id: request?.id || `timer-response-${nextId++}`,
    linkType: "response",
    subtype: request?.subtype || "timer.response",
    source: address(config.domain, config.runtimeID, config.sessionID),
    target: request?.source || address(config.domain, config.targetRuntime, config.targetSession),
    payload: error ? { error } : { result },
  };
}

function envelope(config, linkType, subtype, payload) {
  return {
    type: "envelope",
    id: `timer-${Date.now()}-${nextId++}`,
    linkType,
    subtype,
    source: address(config.domain, config.sourceRuntime, config.sourceSession),
    target: address(config.domain, config.targetRuntime, config.targetSession),
    payload,
  };
}

function toolToSubtype(tool) {
  if (tool === "ListRuntimeTimers") return "timer.list";
  if (tool === "ListAllTimers") return "timer.list_all";
  if (tool === "DeleteRuntimeTimer") return "timer.delete";
  if (String(tool).startsWith("Create")) return "timer.create";
  return "timer.tool";
}

function timerSystemPrompt(timer) {
  return [
    "<timer>",
    `<TimerID>${timer.TimerID}</TimerID>`,
    `<TimerType>${timer.TimerType}</TimerType>`,
    `<Title>${timer.Title}</Title>`,
    `<TriggerAt>${timer.triggerAt}</TriggerAt>`,
    "</timer>",
    "<content>",
    timer.MSG,
    "</content>",
  ].join("\n");
}
