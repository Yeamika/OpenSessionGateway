/**
 * MCP URL helpers — builds MCP server URLs from base URL.
 *
 * Migrated from client-opencode-plugin-v2/lib/mcp-urls.ts
 */

type McpUrlInput = {
  baseUrl?: string
  wsServerUrl?: string
  sessionBridgeUrl?: string
  runtimeControlUrl?: string
}

type McpUrls = {
  sessionBridgeUrl: string
  runtimeControlUrl: string
}

function trimRightSlash(value: string): string {
  return value.replace(/\/+$/, "")
}

export function createMcpServerUrls(input: McpUrlInput = {}): McpUrls {
  const directSession = typeof input.sessionBridgeUrl === "string" ? trimRightSlash(input.sessionBridgeUrl.trim()) : ""
  const directControl = typeof input.runtimeControlUrl === "string" ? trimRightSlash(input.runtimeControlUrl.trim()) : ""

  let base = ""
  if (typeof input.baseUrl === "string" && input.baseUrl.trim()) {
    base = trimRightSlash(input.baseUrl.trim())
  } else {
    const wsSource = typeof input.wsServerUrl === "string" && input.wsServerUrl.trim()
      ? input.wsServerUrl.trim()
      : ""
    if (wsSource) {
      base = wsSource.replace(/^wss?:\/\//i, (match) => (match.toLowerCase() === "wss://" ? "https://" : "http://"))
      base = trimRightSlash(base.replace(/\/wsport$/i, ""))
    }
  }

  return {
    sessionBridgeUrl: directSession || (base ? `${base}/mcp/session_bridge` : ""),
    runtimeControlUrl: directControl || (base ? `${base}/mcp/runtime_control` : ""),
  }
}
