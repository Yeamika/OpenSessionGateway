import type { OsgServerPlugin } from "@opensessiongateway/server-plugin-sdk";

import { disposeTimers, restoreAllTimers, restoreTimersForRuntime } from "./scheduler.js";
import { createTimerManagerMcpPlugin, createTimerSchedulerMcpPlugin } from "./surface.js";

const timerSchedulerPlugin: OsgServerPlugin = {
  manifest: {
    id: "timer-scheduler",
    version: "0.1.0",
    name: "Timer Scheduler",
    description: "One-shot, periodic, and cron timer planner with self-bucket and manager MCP surfaces",
  },
  activate(ctx) {
    ctx.mcp.registerSurface(createTimerSchedulerMcpPlugin(ctx));
    ctx.mcp.registerSurface(createTimerManagerMcpPlugin(ctx));
    void restoreAllTimers(ctx);

    const offRuntimeConnect = ctx.hooks.onRuntimeConnect((event) => {
      void restoreTimersForRuntime(ctx, event.runtimeID);
    });

    return () => {
      offRuntimeConnect();
      disposeTimers();
    };
  },
};

export default timerSchedulerPlugin;
export { createTimerManagerMcpPlugin, createTimerSchedulerMcpPlugin };
