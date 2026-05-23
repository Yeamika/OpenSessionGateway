let nextID = 1;

export function makeOsgpRequest({ source, target, channel, tool, args }) {
  return makeEnvelope({
    payloadType: "request",
    source,
    target,
    body: { channel, tool, args: args || {} },
  });
}

export function makeOsgpControl({ source, target, channel, tool, args }) {
  return makeEnvelope({
    payloadType: "control",
    source,
    target,
    body: { channel, tool, args: args || {} },
  });
}

export function parseOsgpResponse(envelope) {
  const payload = envelope?.payload || envelope?.body || envelope;
  if (payload?.type === "response" && payload.error) throw new Error(payload.error.message || String(payload.error));
  if (payload?.error) throw new Error(payload.error.message || String(payload.error));
  return payload?.result ?? payload?.data ?? payload;
}

function makeEnvelope({ payloadType, source, target, body }) {
  return {
    id: `im-web-${Date.now()}-${nextID++}`,
    source: source || "endpoint:im-web",
    target: target || "endpoint:im-gateway",
    ttl: 8,
    trace: [],
    payload: {
      type: payloadType,
      subtype: "im-gateway.tool",
      body,
    },
  };
}
