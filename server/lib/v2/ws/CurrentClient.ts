import type { QueueShape } from "protocllibrary/ws-contract/CurrentClient.js";

export function handleCurrentClientInfoEvent(queue: QueueShape): { ok: true; data: Record<string, unknown> } {
  const lastEvent = queue.events.length > 0 ? queue.events[queue.events.length - 1] : null;
  const lastEventType =
    lastEvent && typeof lastEvent === "object" && "type" in lastEvent && typeof (lastEvent as { type?: unknown }).type === "string"
      ? (lastEvent as { type: string }).type
      : null;

  return {
    ok: true,
    data: {
      runtimeID: queue.runtimeID,
      host_name: queue.hostName,
      queue_size: queue.events.length,
      last_event_type: lastEventType,
      server_time: new Date().toISOString(),
    },
  };
}
