type McpUrlInput = {
  baseUrl?: string;
  wsServerUrl?: string;
  sessionGatewayUrl?: string;
  gatewayClientControlUrl?: string;
  timerSchedulerUrl?: string;
};

type McpUrls = {
  sessionGatewayUrl: string;
  gatewayClientControlUrl: string;
  timerSchedulerUrl: string;
};

function trimRightSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function createMcpServerUrls(input: McpUrlInput = {}): McpUrls {
  const directSession = typeof input.sessionGatewayUrl === "string" ? trimRightSlash(input.sessionGatewayUrl.trim()) : "";
  const directControl = typeof input.gatewayClientControlUrl === "string" ? trimRightSlash(input.gatewayClientControlUrl.trim()) : "";
  const directTimer = typeof input.timerSchedulerUrl === "string" ? trimRightSlash(input.timerSchedulerUrl.trim()) : "";

  let base = "";
  if (typeof input.baseUrl === "string" && input.baseUrl.trim()) {
    base = trimRightSlash(input.baseUrl.trim());
  } else if (typeof process.env.OSG_BASE_URL === "string" && process.env.OSG_BASE_URL.trim()) {
    base = trimRightSlash(process.env.OSG_BASE_URL.trim());
  } else {
    const wsSource =
      typeof input.wsServerUrl === "string" && input.wsServerUrl.trim()
        ? input.wsServerUrl.trim()
        : typeof process.env.OSG_WS_URL === "string"
          ? process.env.OSG_WS_URL.trim()
          : "";
    if (wsSource) {
      base = wsSource.replace(/^wss?:\/\//i, (match) => (match.toLowerCase() === "wss://" ? "https://" : "http://"));
      base = trimRightSlash(base.replace(/\/wsport$/i, ""));
    }
  }

  return {
    sessionGatewayUrl: directSession || (base ? `${base}/mcp/session_gateway` : ""),
    gatewayClientControlUrl: directControl || (base ? `${base}/mcp/gateway_client_control` : ""),
    timerSchedulerUrl: directTimer || (base ? `${base}/mcp/timer_scheduler` : ""),
  };
}
