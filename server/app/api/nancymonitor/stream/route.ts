import { listRuntimeClients } from "@/lib/runtime-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(pushTimer);
        clearInterval(keepAliveTimer);
        controller.close();
      };

      const pushSnapshot = async () => {
        const clients = await listRuntimeClients();
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "clients",
              timestamp: new Date().toISOString(),
              data: clients,
            })}\n\n`,
          ),
        );
      };

      pushSnapshot().catch(() => {});

      const pushTimer = setInterval(() => {
        pushSnapshot().catch(() => {});
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
