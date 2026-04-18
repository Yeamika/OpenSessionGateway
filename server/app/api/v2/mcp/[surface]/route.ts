import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { ensureAutoloadPluginsLoaded, getMcpPlugin } from "@/lib/plugins/mcp/registry";
import { errorResult } from "@/lib/v2/mcp/common";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ surface?: string }>;
};

async function readSurface(context: RouteContext): Promise<string> {
  const params = await context.params;
  return typeof params.surface === "string" ? params.surface.trim() : "";
}

async function readPlugin(context: RouteContext) {
  await ensureAutoloadPluginsLoaded();
  return getMcpPlugin(await readSurface(context));
}

export async function POST(req: NextRequest, context: RouteContext) {
  const plugin = await readPlugin(context);
  if (!plugin) {
    return NextResponse.json(errorResult(null, -32601, "unknown mcp surface"), { status: 404 });
  }

  try {
    const body = await req.json();
    return plugin.handleRpc(body, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(errorResult(null, -32603, "internal error", { message }), { status: 500 });
  }
}

export async function GET(_req: NextRequest, context: RouteContext) {
  const plugin = await readPlugin(context);
  if (!plugin) {
    return NextResponse.json({ ok: false, error: "unknown mcp surface" }, { status: 404 });
  }
  return NextResponse.json(plugin.info());
}
