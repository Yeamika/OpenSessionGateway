function normalizeBoolean(value: unknown): boolean {
  return value === true;
}

export const PING_EVENT = "Ping";
export const PONG_EVENT = "Pong";

export type PongPayload = {
  pong: boolean;
};

export function createPongPayload(): PongPayload {
  return { pong: true };
}

export function readPongPayload(raw: unknown): PongPayload {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    pong: normalizeBoolean(src.pong),
  };
}
