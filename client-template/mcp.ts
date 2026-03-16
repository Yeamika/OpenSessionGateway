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

const LEGACY_MCP_SERVER_NAMES = [
  "osg_hook_v2",
  "osg_hook_session_manager_v2",
  "osg_hook_session_manager",
  "osg_mcp_v1",
  "osg_mcp_session_manager_v1",
];

export function createMcpTemplates(wsServerUrl?: string): McpServerTemplate[] {
  const urls = createMcpServerUrls({
    wsServerUrl,
    sessionGatewayUrl: process.env.OSG_MCP_SESSION_GATEWAY_URL,
    gatewayClientControlUrl: process.env.OSG_MCP_GATEWAY_CLIENT_CONTROL_URL,
  });

  return [
    {
      name: "session_gateway",
      config: {
        type: "remote",
        url: urls.sessionGatewayUrl,
        oauth: false,
        timeout: 8000,
      },
    },
    {
      name: "gateway_client_control",
      config: {
        type: "remote",
        url: urls.gatewayClientControlUrl,
        oauth: false,
        timeout: 8000,
      },
    },
  ];
}

async function removeServerBestEffort(mcp: McpApi, name: string, query?: Record<string, unknown>) {
  if (typeof mcp.disconnect === "function") {
    await mcp.disconnect({ path: { name }, query }).catch(() => null);
  }
  if (typeof mcp.remove === "function") {
    await mcp.remove({ path: { name }, query }).catch(() => null);
  }
  if (typeof mcp.delete === "function") {
    await mcp.delete({ path: { name }, query }).catch(() => null);
  }
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

  for (const legacy of LEGACY_MCP_SERVER_NAMES) {
    await removeServerBestEffort(mcp, legacy, query);
    writeLog?.(`[mcp] cleanup legacy: ${legacy}`);
  }

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
