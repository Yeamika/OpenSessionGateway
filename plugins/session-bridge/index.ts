import type { OsgServerPlugin } from "@opensessiongateway/server-plugin-sdk";

import { clearAllMailboxReminderTimers, restoreMailboxReminders, restoreMailboxRemindersForRuntime } from "./mailbox.ts";
import { createSessionBridgeMcpPlugin } from "./surface.ts";
import { createSessionBridgeServices } from "./types.ts";

const sessionBridgePlugin: OsgServerPlugin = {
  manifest: {
    id: "session-bridge",
    version: "0.1.0",
    name: "Session Bridge",
    description: "Live session interaction and mailbox MCP surface",
  },
  activate(ctx) {
    const services = createSessionBridgeServices(ctx);
    ctx.mcp.registerSurface(createSessionBridgeMcpPlugin(services));
    void restoreMailboxReminders(services);

    const offRuntimeConnect = ctx.hooks.onRuntimeConnect((event) => {
      void restoreMailboxRemindersForRuntime(services, event.runtimeID);
    });

    return () => {
      offRuntimeConnect();
      clearAllMailboxReminderTimers();
    };
  },
};

export default sessionBridgePlugin;
export { createSessionBridgeMcpPlugin };
