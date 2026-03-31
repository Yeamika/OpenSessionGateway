import type { NextRequest } from "next/server";

export type McpPluginInfo = {
  ok: true;
  endpoint: string;
  server: string;
  implemented: true;
  description?: string;
};

export type McpPlugin = {
  id: string;
  routeSegment: string;
  info: () => McpPluginInfo;
  handleRpc: (body: unknown, request: NextRequest) => Promise<Response>;
};
