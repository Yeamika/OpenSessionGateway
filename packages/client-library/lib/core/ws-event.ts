import { createPongPayload, PING_EVENT } from "@opensessiongateway/protocol-library";

type EventCallbacks = {
  onServerEvent?: (message: any) => Promise<any> | any;
};

function normalizeType(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isAcceptedOnlyResult(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const src = value as Record<string, unknown>;
  const keys = Object.keys(src);
  return keys.length === 1 && keys[0] === "accepted" && src.accepted === true;
}

export async function handleServerEvent(message: any, callbacks: EventCallbacks, runtimeID: string) {
  const type = normalizeType(message?.type);

  if (callbacks && typeof callbacks.onServerEvent === "function") {
    const result = await Promise.resolve(callbacks.onServerEvent(message));
    if (result !== undefined && result !== null && !isAcceptedOnlyResult(result)) {
      return {
        ok: true,
        data: result,
      };
    }
  }

  if (type === PING_EVENT) {
    return {
      ok: true,
      data: createPongPayload(),
    };
  }

  return {
    ok: true,
    data: {
      accepted: true,
      type,
    },
  };
}
