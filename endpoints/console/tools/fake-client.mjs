#!/usr/bin/env node
const routerUrl = arg("--router-url", "ws://127.0.0.1:7200");
const testId = arg("--test-id", `console-smoke-${Date.now()}`);
const domain = arg("--domain", "domain-a");
const runtime = arg("--runtime", `runtime-${testId}`);
const session = arg("--session", `session-${testId}`);
const address = { domain, runtime, session };
const consoleAddress = { domain, runtime: "console-runtime", session: "console" };
const ws = new WebSocket(routerUrl);

ws.addEventListener("open", () => {
  send({ nodeId: `fake-${testId}`, role: "endpoint", addresses: [address], capabilities: [] });
  setTimeout(uploadSession, 200);
  setTimeout(uploadRequestion, 300);
  setInterval(uploadSession, 500);
  setInterval(() => sendReadResponse("runtime_session_view_snapshot", consoleAddress), 500);
});

ws.addEventListener("message", async (event) => {
  const text = typeof event.data === "string" ? event.data : await event.data.text();
  const frame = JSON.parse(text);
  if (frame.type === "ping") return send({ type: "pong" });
  if (frame.type === "read_request") return respondToRead(frame);
  if (frame.type === "envelope" && frame.linkType === "control") return respondToControl(frame);
});

ws.addEventListener("error", (event) => {
  console.error("fake client websocket error", event.message || event.type);
  process.exitCode = 1;
});
process.on("SIGTERM", () => ws.close(1000, "cleanup"));
process.on("SIGINT", () => ws.close(1000, "cleanup"));

function uploadSession(summary = "fake client ready") {
  sendEnvelope("upload", "session_update", address, address, {
    runtimeID: runtime,
    sessionID: session,
    title: `Fake ${testId}`,
    state: "running",
    summary,
  });
}

function uploadRequestion() {
  sendEnvelope("upload", "requestion_asked", address, address, {
    runtimeID: runtime,
    sessionID: session,
    requestID: `req-${testId}`,
    title: "fake pending requestion",
  });
}

function respondToRead(frame) {
  sendReadResponse(frame.subtype, frame.source, frame.requestId, frame.traceId);
}

function respondToControl(frame) {
  uploadSession(`control received: ${frame.subtype}`);
  console.log(`CONTROL_RESPONSE_TARGET=${JSON.stringify(frame.source)}`);
  sendReadResponse(frame.subtype, frame.source);
}

function sendReadResponse(subtype, target, requestId = crypto.randomUUID(), traceId = crypto.randomUUID()) {
  send({
    type: "read_response",
    requestId,
    traceId,
    source: address,
    target,
    status: "ok",
    linkType: "response",
    subtype,
    payload: {
      runtimeID: runtime,
      sessionID: session,
      messages: [{ role: "assistant", text: `hello from ${session}` }],
      state: "running",
      title: `Fake ${testId}`,
      accepted: subtype,
      responseTarget: target,
    },
  });
}

function sendEnvelope(linkType, subtype, source, target, payload) {
  send({
    type: "typed_envelope",
    messageId: crypto.randomUUID(),
    source: { address: source },
    target: { address: target },
    linkType,
    subtype,
    payload: { text: { ...payload, subtype } },
    routeHops: [],
  });
}

function send(value) { ws.send(JSON.stringify(value)); }
function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}
