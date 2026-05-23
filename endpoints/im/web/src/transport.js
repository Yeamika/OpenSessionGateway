import { makeOsgpControl, makeOsgpRequest, parseOsgpResponse } from "./osgp-wire.js";

export function createTransport(getConfig) {
  return {
    call(channel, tool, args = {}) {
      const config = getConfig();
      if (config.mode === "osgp") return callViaOsgp(config, channel, tool, args);
      return callViaMcp(config, channel, tool, args);
    },
  };
}

async function callViaMcp(config, channel, tool, args) {
  const endpoint = channel === "chat" ? config.chatEndpoint : config.controlEndpoint;
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name: tool, arguments: args } }),
  }, config.requestTimeoutMs);
  const rpc = await response.json();
  if (!response.ok || rpc.error) throw new Error(rpc.error?.message || `HTTP ${response.status}`);
  return decodeToolResult(rpc.result);
}

async function callViaOsgp(config, channel, tool, args) {
  if (!config.osgpEndpoint) throw new Error("OSGP endpoint is not configured; IM gateway GV endpoint is TODO.");
  const mutating = /^(Upsert|Create|Delete|Send|RequestUpload|SendRouteUpload)/.test(tool);
  const envelope = mutating
    ? makeOsgpControl({ channel, tool, args })
    : makeOsgpRequest({ channel, tool, args });
  const response = await fetchWithTimeout(config.osgpEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(envelope),
  }, config.requestTimeoutMs);
  const body = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseOsgpResponse(body);
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function decodeToolResult(result) {
  const text = result?.content?.find?.((item) => item.type === "text")?.text;
  if (typeof text !== "string") return result;
  try { return JSON.parse(text); } catch { return text; }
}
