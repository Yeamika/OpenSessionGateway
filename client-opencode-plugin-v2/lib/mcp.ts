import { LEGACY_MCP_SERVER_NAMES, MCP_SERVER_NAMES } from "./constants.js";
import { createMcpServerUrls } from "./mcp-urls.js";

function isGatewayClientControlEnabled(): boolean {
  return process.env.OSG_MCP_CLIENT_CONOTRL_ENABLE === "1";
}

async function withTimeout(promise: Promise<boolean>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  const result = await Promise.race([promise, timeout]).catch(() => false);
  clearTimeout(timer!);
  return result;
}

async function ensureMcpServer(
  ctx: any,
  query: () => Record<string, unknown>,
  input: { name: string; config: unknown },
): Promise<boolean> {
  const statusResult = await ctx.client.mcp.status({ query: query() }).catch(() => null);
  const statusMap = statusResult && !statusResult.error ? statusResult.data : null;
  const status = statusMap && statusMap[input.name] ? statusMap[input.name].status : "";

  if (!status) {
    const addResult = await ctx.client.mcp.add({
      body: { name: input.name, config: input.config },
      query: query(),
    });
    return !addResult?.error;
  }

  // Existing MCP server entry already present in status map.
  // Do not force an explicit connect call here to avoid blocking startup.
  return true;
}

function withRuntimeIDQuery(config: unknown, runtimeID: string): unknown {
  if (!config || typeof config !== "object") return config;
  const src = config as Record<string, unknown>;
  const type = typeof src.type === "string" ? src.type.trim() : "";
  if (type !== "remote") return config;
  const cleanRuntimeID = typeof runtimeID === "string" ? runtimeID.trim() : "";
  if (!cleanRuntimeID) return config;

  const rawUrl = typeof src.url === "string" ? src.url.trim() : "";
  if (!rawUrl) return config;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return config;
  }
  url.searchParams.set("runtimeID", cleanRuntimeID);

  return {
    ...src,
    url: url.toString(),
  };
}

async function removeMcpServerBestEffort(
  ctx: any,
  query: () => Record<string, unknown>,
  name: string,
): Promise<void> {
  const mcp = ctx?.client?.mcp;
  if (!mcp || typeof name !== "string" || !name.trim()) return;
  const clean = name.trim();

  const ops: Array<() => Promise<unknown>> = [];
  if (typeof mcp.disconnect === "function") {
    ops.push(() => mcp.disconnect({ path: { name: clean }, query: query() }));
  }
  if (typeof mcp.remove === "function") {
    ops.push(() => mcp.remove({ path: { name: clean }, query: query() }));
  }
  if (typeof mcp.delete === "function") {
    ops.push(() => mcp.delete({ path: { name: clean }, query: query() }));
  }

  for (const op of ops) {
    await Promise.resolve(op()).catch(() => null);
  }
}

async function cleanupLegacyMcpServers(
  ctx: any,
  query: () => Record<string, unknown>,
  writeLog: (level: string, message: string, extra?: Record<string, unknown>) => Promise<void>,
) {
  for (const name of LEGACY_MCP_SERVER_NAMES) {
    await removeMcpServerBestEffort(ctx, query, name);
    await writeLog("info", "mcp legacy cleanup", { name });
  }
}

export function scheduleMcpSetup(
  ctx: any,
  query: () => Record<string, unknown>,
  writeLog: (level: string, message: string, extra?: Record<string, unknown>) => Promise<void>,
  getRuntimeID?: () => string,
  getWsServerUrl?: () => string,
) {
  const showSetupErrorToast = async (name: string) => {
    await ctx?.client?.tui?.showToast?.({
      body: {
        title: "OSG-MCP",
        message: `MCP server connect failed: ${name}`,
        variant: "error",
        duration: 5000,
      },
      query: query(),
    }).catch(() => null);
  };

  const setup = async () => {
    try {
      await cleanupLegacyMcpServers(ctx, query, writeLog);
      const runtimeID = typeof getRuntimeID === "function" ? getRuntimeID() : "";
      const wsServerUrl = typeof getWsServerUrl === "function" ? getWsServerUrl() : "";
      const urls = createMcpServerUrls({
        baseUrl: process.env.OSG_BASE_URL,
        wsServerUrl,
      });

      const configByName: Record<string, unknown> = {
        session_gateway: {
          type: "remote",
          url: urls.sessionGatewayUrl,
          oauth: false,
          timeout: 8000,
        },
        gateway_client_control: {
          type: "remote",
          url: urls.gatewayClientControlUrl,
          oauth: false,
          timeout: 8000,
        },
        timer_scheduler: {
          type: "remote",
          url: urls.timerSchedulerUrl,
          oauth: false,
          timeout: 8000,
        },
      };

      const enabledNames = MCP_SERVER_NAMES.filter((name) => {
        if (name !== "gateway_client_control") return true;
        return isGatewayClientControlEnabled();
      });

      for (const name of enabledNames) {
        const config = withRuntimeIDQuery(configByName[name], runtimeID);
        const ok = await withTimeout(
          ensureMcpServer(ctx, query, { name, config }),
          5000,
        );
        await writeLog(ok ? "info" : "warn", "mcp setup result", {
          name,
          ok,
          runtimeID: runtimeID || "",
          wsServerUrl: wsServerUrl || "",
        });
        if (!ok) {
          await showSetupErrorToast(name);
        }
      }

      if (!isGatewayClientControlEnabled()) {
        await writeLog("info", "mcp setup skipped", {
          name: "gateway_client_control",
          reason: "OSG_MCP_CLIENT_CONOTRL_ENABLE != 1",
        });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await writeLog("error", "mcp setup failed", { error: msg });
      await showSetupErrorToast("setup");
    }
  };

  queueMicrotask(() => {
    void setup();
  });
}
