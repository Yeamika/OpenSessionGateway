import { createWsErrorEnvelope, readWsErrorEnvelope, WS_ERROR_TYPE, type WsErrorEnvelope } from "../WsEnvelope.js";

export const ERROR_EVENT = WS_ERROR_TYPE;

export function createBasicError(input: { code?: string; message?: string }): WsErrorEnvelope {
  return createWsErrorEnvelope(input);
}

export function readBasicError(raw: unknown): WsErrorEnvelope {
  return readWsErrorEnvelope(raw);
}
