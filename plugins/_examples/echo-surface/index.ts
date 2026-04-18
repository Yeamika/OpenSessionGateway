import type { OsgServerPlugin } from "@opensessiongateway/server-plugin-sdk";

function success(id: unknown, result: unknown) {
  return Response.json({ jsonrpc: "2.0", id, result });
}

function failure(id: unknown, code: number, message: string) {
  return Response.json({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });
}

function parseRpc(body: unknown): {
  id: unknown;
  method: string;
  params: Record<string, unknown>;
} {
  const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  return {
    id: payload.id ?? null,
    method: typeof payload.method === "string" ? payload.method.trim() : "",
    params: payload.params && typeof payload.params === "object"
      ? (payload.params as Record<string, unknown>)
      : {},
  };
}

const echoSurfacePlugin: OsgServerPlugin = {
  manifest: {
    id: "example.echo-surface",
    version: "0.1.0",
    name: "Echo Surface",
    description: "Example package plugin used for hot-load smoke tests",
  },
  activate(ctx) {
    ctx.log("info", "registering echo surface");

    ctx.mcp.registerSurface({
      id: "example.echo-surface.surface",
      routeSegment: "echo_surface",
      info() {
        return {
          ok: true,
          endpoint: "/api/v2/mcp/echo_surface",
          server: "echo_surface",
          implemented: true,
          description: "Example dynamic surface loaded from plugins/",
        };
      },
      async handleRpc(body) {
        const { id, method, params } = parseRpc(body);

        if (method === "initialize") {
          return success(id, {
            protocolVersion: "2025-03-26",
            serverInfo: {
              name: "echo_surface",
              version: "0.1.0",
            },
            capabilities: {
              tools: { listChanged: false },
            },
          });
        }

        if (method === "notifications/initialized") {
          return new Response(null, { status: 202 });
        }

        if (method === "tools/list") {
          return success(id, {
            tools: [
              {
                name: "Ping",
                description: "Return a package-plugin response",
                inputSchema: {
                  type: "object",
                  properties: {
                    message: { type: "string", description: "Optional ping text" },
                  },
                  additionalProperties: false,
                },
              },
            ],
          });
        }

        if (method === "tools/call") {
          const toolName = typeof params.name === "string" ? params.name.trim() : "";
          const toolArgs = params.arguments && typeof params.arguments === "object"
            ? (params.arguments as Record<string, unknown>)
            : {};

          if (toolName !== "Ping") {
            return failure(id, -32601, `unknown tool: ${toolName || "<empty>"}`);
          }

          const message = typeof toolArgs.message === "string" && toolArgs.message.trim()
            ? toolArgs.message.trim()
            : "hello from package plugin";

          return success(id, {
            content: [{
              type: "text",
              text: JSON.stringify({
                ok: true,
                plugin: "example.echo-surface",
                routeSegment: "echo_surface",
                message,
              }, null, 2),
            }],
          });
        }

        return failure(id, -32601, `method not found: ${method}`);
      },
    });

    const offConnect = ctx.hooks.onRuntimeConnect((event) => {
      ctx.log("info", "runtime connected", event);
    });

    return () => {
      offConnect();
      ctx.log("info", "echo surface cleaned up");
    };
  },
};

export default echoSurfacePlugin;
