import { NextRequest, NextResponse } from "next/server";

import { errorResult } from "@/lib/v2/mcp/common";
import { handleTimerSchedulerRpc, timerSchedulerInfo } from "@/lib/v2/mcp/timer-scheduler/timer-scheduler";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    return handleTimerSchedulerRpc(body, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(errorResult(null, -32603, "internal error", { message }), { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json(timerSchedulerInfo());
}
