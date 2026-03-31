import { createMcpServerUrls } from "./mcp-urls.js";

type McpServerTemplate = {
  name: string;
  config: {
    type: "remote";
    url: string;
    oauth: false;
    timeout: number;
  };
};

type McpApi = {
  status?: (input: { query?: Record<string, unknown> }) => Promise<{ error?: unknown; data?: Record<string, { status?: string }> } | null>;
  add?: (input: { body: { name: string; config: unknown }; query?: Record<string, unknown> }) => Promise<unknown>;
  connect?: (input: { path: { name: string }; query?: Record<string, unknown> }) => Promise<{ error?: unknown } | null>;
  disconnect?: (input: { path: { name: string }; query?: Record<string, unknown> }) => Promise<unknown>;
  remove?: (input: { path: { name: string }; query?: Record<string, unknown> }) => Promise<unknown>;
  delete?: (input: { path: { name: string }; query?: Record<string, unknown> }) => Promise<unknown>;
};

export function createMcpTemplates(wsServerUrl?: string): McpServerTemplate[] {
  const urls = createMcpServerUrls({
    wsServerUrl,
  });

  return [
    {
      name: "session_bridge",
      config: {
        type: "remote",
        url: urls.sessionBridgeUrl,
        oauth: false,
        timeout: 8000,
      },
    },
    {
      name: "runtime_control",
      config: {
        type: "remote",
        url: urls.runtimeControlUrl,
        oauth: false,
        timeout: 8000,
      },
    },
  ];
}

export async function setupMcpServers(
  mcp: McpApi,
  input?: {
    query?: Record<string, unknown>;
    wsServerUrl?: string;
    writeLog?: (line: string) => void;
  },
) {
  const query = input?.query;
  const writeLog = input?.writeLog;
  const templates = createMcpTemplates(input?.wsServerUrl);

  for (const template of templates) {
    let exists = false;
    if (typeof mcp.status === "function") {
      const statusResult = await mcp.status({ query }).catch(() => null);
      exists = Boolean(statusResult && !statusResult.error && statusResult.data && statusResult.data[template.name]?.status);
    }

    if (!exists && typeof mcp.add === "function") {
      await mcp.add({ body: { name: template.name, config: template.config }, query }).catch(() => null);
    }

    let connected = false;
    if (typeof mcp.connect === "function") {
      const connectResult = await mcp.connect({ path: { name: template.name }, query }).catch(() => null);
      connected = Boolean(connectResult && !connectResult.error);
    }

    writeLog?.(`[mcp] setup ${template.name}: ${connected ? "ok" : "failed"}`);
  }
}
