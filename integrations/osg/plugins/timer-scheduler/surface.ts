import { NextResponse } from "next/server.js";

import type { PluginContext, McpPlugin } from "@opensessiongateway/server-plugin-sdk";

import { createCronTimer, createOneShotTimer, createPeriodicTimer, deleteRuntimeTimer, listAllTimers, listTimers } from "./scheduler.js";
import { errorResult, normalizeString, parseRpc, positiveInt, successResult, textResult } from "./common.js";

const SELF_TOOLS = [
  {
    name: "CreateOneShotTimer",
    description: "Add one-shot timer to current executor session bucket",
    inputSchema: {
      type: "object",
      properties: {
        ExecutorSessionID: { type: "string", description: "Executor sessionID" },
        title: { type: "string", description: "Optional title, default: timer task" },
        msg: { type: "string", description: "Timer message" },
        afterSeconds: { type: "number", description: "Trigger after N seconds" },
      },
      required: ["ExecutorSessionID", "msg", "afterSeconds"],
      additionalProperties: false,
    },
  },
  {
    name: "CreatePeriodicTimer",
    description: "Add periodic timer to current executor session bucket",
    inputSchema: {
      type: "object",
      properties: {
        ExecutorSessionID: { type: "string", description: "Executor sessionID" },
        title: { type: "string", description: "Optional title, default: periodic timer" },
        msg: { type: "string", description: "Timer message" },
        everySeconds: { type: "number", description: "Repeat every N seconds" },
      },
      required: ["ExecutorSessionID", "msg", "everySeconds"],
      additionalProperties: false,
    },
  },
  {
    name: "CreateCronTimer",
    description: "Add cron timer to current executor session bucket in UTC",
    inputSchema: {
      type: "object",
      properties: {
        ExecutorSessionID: { type: "string", description: "Executor sessionID" },
        title: { type: "string", description: "Optional title, default: cron timer" },
        msg: { type: "string", description: "Timer message" },
        cronExpr: { type: "string", description: "UTC cron expression: minute hour day month weekday" },
      },
      required: ["ExecutorSessionID", "msg", "cronExpr"],
      additionalProperties: false,
    },
  },
  {
    name: "DeleteRuntimeTimer",
    description: "Delete one timer from current executor session bucket",
    inputSchema: {
      type: "object",
      properties: {
        ExecutorSessionID: { type: "string", description: "Executor sessionID" },
        timerID: { type: "string", description: "TimerID to delete" },
      },
      required: ["ExecutorSessionID", "timerID"],
      additionalProperties: false,
    },
  },
  {
    name: "ListRuntimeTimers",
    description: "List timers in current executor session bucket",
    inputSchema: {
      type: "object",
      properties: {
        ExecutorSessionID: { type: "string", description: "Executor sessionID" },
      },
      required: ["ExecutorSessionID"],
      additionalProperties: false,
    },
  },
];

const MANAGER_TOOLS = [
  {
    name: "CreateOneShotTimer",
    description: "Add one-shot timer to runtime/session",
    inputSchema: {
      type: "object",
      properties: {
        runtimeID: { type: "string", description: "Target runtimeID" },
        sessionID: { type: "string", description: "Target sessionID" },
        title: { type: "string", description: "Optional title, default: timer task" },
        msg: { type: "string", description: "Timer message" },
        afterSeconds: { type: "number", description: "Trigger after N seconds" },
      },
      required: ["runtimeID", "sessionID", "msg", "afterSeconds"],
      additionalProperties: false,
    },
  },
  {
    name: "CreatePeriodicTimer",
    description: "Add periodic timer to runtime/session",
    inputSchema: {
      type: "object",
      properties: {
        runtimeID: { type: "string", description: "Target runtimeID" },
        sessionID: { type: "string", description: "Target sessionID" },
        title: { type: "string", description: "Optional title, default: periodic timer" },
        msg: { type: "string", description: "Timer message" },
        everySeconds: { type: "number", description: "Repeat every N seconds" },
      },
      required: ["runtimeID", "sessionID", "msg", "everySeconds"],
      additionalProperties: false,
    },
  },
  {
    name: "CreateCronTimer",
    description: "Add cron timer to runtime/session in UTC",
    inputSchema: {
      type: "object",
      properties: {
        runtimeID: { type: "string", description: "Target runtimeID" },
        sessionID: { type: "string", description: "Target sessionID" },
        title: { type: "string", description: "Optional title, default: cron timer" },
        msg: { type: "string", description: "Timer message" },
        cronExpr: { type: "string", description: "UTC cron expression: minute hour day month weekday" },
      },
      required: ["runtimeID", "sessionID", "msg", "cronExpr"],
      additionalProperties: false,
    },
  },
  {
    name: "DeleteRuntimeTimer",
    description: "Delete one timer by TimerID under runtime/session",
    inputSchema: {
      type: "object",
      properties: {
        runtimeID: { type: "string", description: "Target runtimeID" },
        sessionID: { type: "string", description: "Target sessionID" },
        timerID: { type: "string", description: "TimerID to delete" },
      },
      required: ["runtimeID", "sessionID", "timerID"],
      additionalProperties: false,
    },
  },
  {
    name: "ListRuntimeTimers",
    description: "List timers under runtime/session",
    inputSchema: {
      type: "object",
      properties: {
        runtimeID: { type: "string", description: "Target runtimeID" },
        sessionID: { type: "string", description: "Target sessionID" },
      },
      required: ["runtimeID", "sessionID"],
      additionalProperties: false,
    },
  },
  {
    name: "ListAllTimers",
    description: "List all timers across all runtime/session buckets",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
];

function readRuntimeIDFromRequest(request: unknown): string {
  const urlValue = request && typeof request === "object" && "url" in request ? (request as { url?: unknown }).url : "";
  const url = new URL(typeof urlValue === "string" ? urlValue : "http://localhost/");
  return normalizeString(url.searchParams.get("runtimeID"));
}

function initResult(id: unknown, server: string) {
  return NextResponse.json(successResult(id, {
    protocolVersion: "2025-03-26",
    serverInfo: {
      name: server,
      version: "0.1.0",
    },
    capabilities: {
      tools: { listChanged: false },
    },
  }));
}

export function createTimerSchedulerMcpPlugin(context: PluginContext): McpPlugin {
  return {
    id: "timer-scheduler.surface.self",
    routeSegment: "timer_scheduler",
    info() {
      return {
        ok: true,
        endpoint: "/api/v2/mcp/timer_scheduler",
        server: "timer_scheduler",
        implemented: true,
        description: "Per-session timer scheduler limited to the current executor bucket",
      };
    },
    async handleRpc(body, request) {
      const { id, method, params } = parseRpc(body);

      if (method === "initialize") {
        return initResult(id, "timer_scheduler");
      }

      if (method === "notifications/initialized") {
        return new NextResponse(null, { status: 202 });
      }

      if (method === "tools/list") {
        return NextResponse.json(successResult(id, { tools: SELF_TOOLS }));
      }

      if (method === "tools/call") {
        const runtimeID = readRuntimeIDFromRequest(request);
        if (!runtimeID) {
          return NextResponse.json(errorResult(id, -32602, "runtimeID query parameter is required"));
        }

        const name = normalizeString(params.name);
        const args = params.arguments && typeof params.arguments === "object"
          ? (params.arguments as Record<string, unknown>)
          : {};

        try {
          const sessionID = normalizeString(args.ExecutorSessionID);

          if (name === "CreateOneShotTimer") {
            const result = await createOneShotTimer(context, {
              runtimeID,
              sessionID,
              title: normalizeString(args.title) || "timer task",
              msg: normalizeString(args.msg),
              afterSeconds: positiveInt(args.afterSeconds, "afterSeconds"),
            });
            return NextResponse.json(successResult(id, textResult(result)));
          }

          if (name === "CreatePeriodicTimer") {
            const result = await createPeriodicTimer(context, {
              runtimeID,
              sessionID,
              title: normalizeString(args.title) || "periodic timer",
              msg: normalizeString(args.msg),
              everySeconds: positiveInt(args.everySeconds, "everySeconds"),
            });
            return NextResponse.json(successResult(id, textResult(result)));
          }

          if (name === "CreateCronTimer") {
            const result = await createCronTimer(context, {
              runtimeID,
              sessionID,
              title: normalizeString(args.title) || "cron timer",
              msg: normalizeString(args.msg),
              cronExpr: normalizeString(args.cronExpr),
            });
            return NextResponse.json(successResult(id, textResult(result)));
          }

          if (name === "DeleteRuntimeTimer") {
            const result = await deleteRuntimeTimer(context, {
              runtimeID,
              sessionID,
              timerID: normalizeString(args.timerID),
            });
            return NextResponse.json(successResult(id, textResult(result)));
          }

          if (name === "ListRuntimeTimers") {
            const result = await listTimers(context, {
              runtimeID,
              sessionID,
            });
            return NextResponse.json(successResult(id, textResult({ realsize: result.length, list: result })));
          }

          return NextResponse.json(errorResult(id, -32601, `unknown tool: ${name || "<empty>"}`));
        } catch (error) {
          return NextResponse.json(errorResult(
            id,
            -32602,
            error instanceof Error ? error.message : String(error),
          ));
        }
      }

      if (id === undefined || id === null) {
        return new NextResponse(null, { status: 202 });
      }

      return NextResponse.json(errorResult(id, -32601, `method not found: ${method}`));
    },
  };
}

export function createTimerManagerMcpPlugin(context: PluginContext): McpPlugin {
  return {
    id: "timer-scheduler.surface.manager",
    routeSegment: "timer_manager",
    info() {
      return {
        ok: true,
        endpoint: "/api/v2/mcp/timer_manager",
        server: "timer_manager",
        implemented: true,
        description: "Manager surface that can inspect and manage timers across all buckets",
      };
    },
    async handleRpc(body) {
      const { id, method, params } = parseRpc(body);

      if (method === "initialize") {
        return initResult(id, "timer_manager");
      }

      if (method === "notifications/initialized") {
        return new NextResponse(null, { status: 202 });
      }

      if (method === "tools/list") {
        return NextResponse.json(successResult(id, { tools: MANAGER_TOOLS }));
      }

      if (method === "tools/call") {
        const name = normalizeString(params.name);
        const args = params.arguments && typeof params.arguments === "object"
          ? (params.arguments as Record<string, unknown>)
          : {};

        try {
          if (name === "CreateOneShotTimer") {
            const result = await createOneShotTimer(context, {
              runtimeID: normalizeString(args.runtimeID),
              sessionID: normalizeString(args.sessionID),
              title: normalizeString(args.title) || "timer task",
              msg: normalizeString(args.msg),
              afterSeconds: positiveInt(args.afterSeconds, "afterSeconds"),
            });
            return NextResponse.json(successResult(id, textResult(result)));
          }

          if (name === "CreatePeriodicTimer") {
            const result = await createPeriodicTimer(context, {
              runtimeID: normalizeString(args.runtimeID),
              sessionID: normalizeString(args.sessionID),
              title: normalizeString(args.title) || "periodic timer",
              msg: normalizeString(args.msg),
              everySeconds: positiveInt(args.everySeconds, "everySeconds"),
            });
            return NextResponse.json(successResult(id, textResult(result)));
          }

          if (name === "CreateCronTimer") {
            const result = await createCronTimer(context, {
              runtimeID: normalizeString(args.runtimeID),
              sessionID: normalizeString(args.sessionID),
              title: normalizeString(args.title) || "cron timer",
              msg: normalizeString(args.msg),
              cronExpr: normalizeString(args.cronExpr),
            });
            return NextResponse.json(successResult(id, textResult(result)));
          }

          if (name === "DeleteRuntimeTimer") {
            const result = await deleteRuntimeTimer(context, {
              runtimeID: normalizeString(args.runtimeID),
              sessionID: normalizeString(args.sessionID),
              timerID: normalizeString(args.timerID),
            });
            return NextResponse.json(successResult(id, textResult(result)));
          }

          if (name === "ListRuntimeTimers") {
            const result = await listTimers(context, {
              runtimeID: normalizeString(args.runtimeID),
              sessionID: normalizeString(args.sessionID),
            });
            return NextResponse.json(successResult(id, textResult({ realsize: result.length, list: result })));
          }

          if (name === "ListAllTimers") {
            const result = await listAllTimers(context);
            return NextResponse.json(successResult(id, textResult({ realsize: result.length, list: result })));
          }

          return NextResponse.json(errorResult(id, -32601, `unknown tool: ${name || "<empty>"}`));
        } catch (error) {
          return NextResponse.json(errorResult(
            id,
            -32602,
            error instanceof Error ? error.message : String(error),
          ));
        }
      }

      if (id === undefined || id === null) {
        return new NextResponse(null, { status: 202 });
      }

      return NextResponse.json(errorResult(id, -32601, `method not found: ${method}`));
    },
  };
}
