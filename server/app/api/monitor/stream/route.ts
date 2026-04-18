import {
  createMonitorPatchPayload,
  createMonitorSnapshotPayload,
  sortMonitorClients,
  toMonitorClient,
  type MonitorClient,
} from "@/lib/frontend/monitor-contract";
import { listRuntimeClients } from "@/lib/runtime-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let initialized = false;
      let previous = new Map<string, string>();

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(pushTimer);
        clearInterval(keepAliveTimer);
        controller.close();
      };

      const encodePayload = (payload: unknown) => encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);

      const takeSnapshot = async (): Promise<MonitorClient[]> => {
        const clients = (await listRuntimeClients()).map(toMonitorClient);
        return sortMonitorClients(clients);
      };

      const pushDelta = async () => {
        const clients = await takeSnapshot();
        const next = new Map<string, string>();
        clients.forEach((client) => {
          next.set(client.key, JSON.stringify(client));
        });

        if (!initialized) {
          previous = next;
          initialized = true;
          controller.enqueue(encodePayload(createMonitorSnapshotPayload(clients)));
          return;
        }

        const upsert: MonitorClient[] = [];
        for (const client of clients) {
          const serialized = next.get(client.key) || "";
          if (previous.get(client.key) !== serialized) {
            upsert.push(client);
          }
        }

        const remove: string[] = [];
        for (const key of previous.keys()) {
          if (!next.has(key)) {
            remove.push(key);
          }
        }

        previous = next;
        if (!upsert.length && !remove.length) {
          return;
        }

        controller.enqueue(encodePayload(createMonitorPatchPayload(upsert, remove)));
      };

      pushDelta().catch(() => {});

      const pushTimer = setInterval(() => {
        pushDelta().catch(() => {});
      }, 5000);

      const keepAliveTimer = setInterval(() => {
        controller.enqueue(encoder.encode("event: ping\ndata: {}\n\n"));
      }, 15000);

      request.signal.addEventListener("abort", close);
    },
    cancel() {
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
