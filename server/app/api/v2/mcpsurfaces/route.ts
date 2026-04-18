import { NextResponse } from "next/server";

import { listPluginSummaries } from "@/lib/plugins/host";
import { ensureAutoloadPluginsLoaded } from "@/lib/plugins/mcp/registry";

export const runtime = "nodejs";

export async function GET() {
  await ensureAutoloadPluginsLoaded();

  const plugins = listPluginSummaries().sort((a, b) => a.id.localeCompare(b.id));
  const surfaces = [...new Set(
    plugins.flatMap((plugin) => plugin.routeSegments.filter((item) => typeof item === "string" && item.trim().length > 0)),
  )].sort((a, b) => a.localeCompare(b));

  return NextResponse.json({
    ok: true,
    surfaces,
    plugins: plugins.map((plugin) => ({
      id: plugin.id,
      routeSegments: plugin.routeSegments,
    })),
  });
}
