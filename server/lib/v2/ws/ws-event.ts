import { handleCurrentClientInfoEvent } from "./CurrentClient";
import type { ListSessionRequestPayload } from "protocllibrary/ws-contract/SessionList.js";

type HandleResult = {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
};

export async function handleWsEvent(
  queue: { runtimeID: string; hostName: string; events: unknown[] },
  type: string,
  payload: Record<string, unknown>,
  _emitToQueue: (runtimeID: string, eventType: string, data?: unknown, timeoutMs?: number) => Promise<unknown>,
): Promise<HandleResult> {
  if (type === "RequestCurrentInfo") {
    return handleCurrentClientInfoEvent(queue);
  }

  if (type === "ListSession") {
    return {
      ok: true,
      data: payload as ListSessionRequestPayload,
    };
  }

  return { ok: true, accepted: true };
}
