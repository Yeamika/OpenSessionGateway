import { NextResponse } from "next/server";

import { redis } from "@/lib/redis";

export async function GET() {
  try {
    await redis.ping();

    return NextResponse.json({
      healthy: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        healthy: false,
        error: error instanceof Error ? error.message : "unknown error",
      },
      { status: 500 },
    );
  }
}
