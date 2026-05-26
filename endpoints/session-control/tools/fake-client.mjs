#!/usr/bin/env node
const routerUrl = arg("--router-url", "ws://127.0.0.1:7200");
const testId = arg("--test-id", `session-endpoint-smoke-${Date.now()}`);
const runtime = arg("--runtime", `fake-runtime-${testId}`);
const session = arg("--session", `fake-session-${testId}`);
const domain = arg("--domain", "domain-a");
const address = { domain, runtime, session };
const ws = new WebSocket(routerUrl);

ws.addEventListener("open", () => {
  send({ nodeId: `fake-client-${testId}`, role: "endpoint", addresses: [address], capabilities: [] });
  setTimeout(() => upload("running", "fake client ready"), 200);
});

ws.addEventListener("message", async (event) => {
  const text = typeof event.data === "string" ? event.data : await event.data.text();
  const frame = JSON.parse(text);
  if (frame.type === "ping") return send({ type: "pong" });
  if (frame.type !== "typed_envelope") return;
  if (frame.linkType === "request") return respond(frame, requestPayload(frame));
  if (frame.linkType === "control") {
    upload("running", `control received: ${frame.subtype}`);
    return respond(frame, { ok: true, accepted: frame.subtype, echo: frame.payload });
  }
});

ws.addEventListener("error", (event) => {
  console.error("fake-client websocket error", event.message || event.type);
  process.exitCode = 1;
});

process.on("SIGTERM", () => ws.close(1000, "test cleanup"));
process.on("SIGINT", () => ws.close(1000, "test cleanup"));

function requestPayload(frame) {
  if (frame.subtype === "runtime_session_messages") {
    return { messages: [{ role: "assistant", text: `hello from ${session}` }], sessionId: session };
  }
  return { sessionId: session, state: "running", title: `Fake ${testId}` };
}

function respond(frame, payload) {
  send({
    type: "typed_envelope",
    messageId: frame.messageId,
    source: { address },
    target: frame.source,
    payload: { text: { subtype: frame.subtype, body: payload } },
    linkType: "response",
    subtype: frame.subtype,
    routeHops: [],
  });
}

function upload(state, summary) {
  send({
    type: "typed_envelope",
    messageId: crypto.randomUUID(),
    source: { address },
    target: { address },
    payload: {
      sessionUpdate: { sessionId: session, state, title: `Fake ${testId}`, summary, metadata: { runtime } },
    },
    linkType: "upload",
    subtype: "session_update",
    routeHops: [],
  });
}

function send(value) {
  ws.send(JSON.stringify(value));
}

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}
