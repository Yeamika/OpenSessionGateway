import { createWsEnvelope, readWsEnvelope, type WsEnvelope } from "../WsEnvelope.js";

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export const CONNECTED_EVENT = "connected";

export type ConnectedPayload = {
  runtimeID: string;
};

export function createConnectedPayload(input: { runtimeID?: string }): ConnectedPayload {
  return {
    runtimeID: normalizeString(input.runtimeID),
  };
}

export function readConnectedPayload(raw: unknown): ConnectedPayload {
  return createConnectedPayload(raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {});
}

export function createConnectedEnvelope(input: { runtimeID?: string }): WsEnvelope<ConnectedPayload> {
  return createWsEnvelope({
    type: CONNECTED_EVENT,
    requestID: "",
    data: createConnectedPayload(input),
  });
}

export function readConnectedEnvelope(raw: unknown): WsEnvelope<ConnectedPayload> {
  const envelope = readWsEnvelope<ConnectedPayload>(raw);
  return {
    ...envelope,
    type: CONNECTED_EVENT,
    data: readConnectedPayload(envelope.data),
  };
}
