import { NextRequest, NextResponse } from "next/server";

import { bindCallerToRuntime, resolveRuntimeByCaller } from "@/lib/runtime-hub";
import { hasOnlineRuntime } from "@/lib/runtime-validation";
import { errorResult, parseRpc, successResult } from "@/lib/v2/mcp/common";
import { callerKey, normalizeInitParams, runtimeIDFromQuery, textResult } from "./common";
import { ADD_ONE_SHOT_TIMER_TOOL, handleAddOneShotTimerTool } from "./tools/AddOneShotTimer";
import { LIST_RUNTIME_TIMERS_TOOL, handleListRuntimeTimersTool } from "./tools/ListRuntimeTimers";

export const TIMER_SCHEDULER_TOOLS = [ADD_ONE_SHOT_TIMER_TOOL, LIST_RUNTIME_TIMERS_TOOL];

export async function handleTimerSchedulerRpc(body: unknown, req: NextRequest) {
  const { id, method } = parseRpc(body);
  const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const params = payload.params && typeof payload.params === "object" ? (payload.params as Record<string, unknown>) : {};

  if (method === "initialize") {
    const init = normalizeInitParams(params, req);
    const initRuntimeID = init.runtimeID || runtimeIDFromQuery(req);

    if (!initRuntimeID) {
      return NextResponse.json(errorResult(id, -32602, "initialize requires runtimeID"));
    }

    const runtimeOnline = await hasOnlineRuntime(initRuntimeID);
    if (!runtimeOnline) {
      return NextResponse.json(errorResult(id, -32002, "runtimeID is not connected via ws"));
    }

    const key = callerKey(req);
    if (key && initRuntimeID) {
      bindCallerToRuntime(key, initRuntimeID);
    }

    return NextResponse.json(
      successResult(id, {
        protocolVersion: "2025-03-26",
        serverInfo: {
          name: "timer_scheduler",
          version: "0.1.0",
        },
        capabilities: {
          tools: { listChanged: false },
        },
      }),
    );
  }

  if (method === "notifications/initialized") {
    return new NextResponse(null, { status: 202 });
  }

  if (method === "tools/list") {
    return NextResponse.json(successResult(id, { tools: TIMER_SCHEDULER_TOOLS }));
  }

  if (method === "tools/call") {
    const runtimeID = runtimeIDFromQuery(req) || resolveRuntimeByCaller(callerKey(req));
    if (!runtimeID) {
      return NextResponse.json(errorResult(id, -32001, "runtimeID required in query"));
    }

    const runtimeOnline = await hasOnlineRuntime(runtimeID);
    if (!runtimeOnline) {
      return NextResponse.json(errorResult(id, -32002, "handshake runtimeID is offline"));
    }

    const toolName = typeof params.name === "string" ? params.name.trim() : "";
    const toolArgs = params.arguments && typeof params.arguments === "object"
      ? (params.arguments as Record<string, unknown>)
      : {};

    try {
      if (toolName === "AddOneShotTimer") {
        return NextResponse.json(successResult(id, textResult(await handleAddOneShotTimerTool(toolArgs))));
      }
      if (toolName === "ListRuntimeTimers") {
        return NextResponse.json(successResult(id, textResult(await handleListRuntimeTimersTool(toolArgs))));
      }
      return NextResponse.json(errorResult(id, -32601, `unknown tool: ${toolName || "<empty>"}`));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return NextResponse.json(errorResult(id, -32602, message));
    }
  }

  if (id === undefined || id === null) {
    return new NextResponse(null, { status: 202 });
  }

  return NextResponse.json(errorResult(id, -32601, `method not found: ${method}`));
}

export function timerSchedulerInfo() {
  return {
    ok: true,
    endpoint: "/api/v2/mcp/timer_scheduler",
    server: "timer_scheduler",
    implemented: true,
  };
}
