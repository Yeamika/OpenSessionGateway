import type { OsgServerPlugin } from "@opensessiongateway/server-plugin-sdk";

import {
  clearAllMailboxReminderTimers,
  clearAllMailboxReminderWatchers,
  restoreMailboxReminders,
  restoreMailboxRemindersForRuntime,
} from "./mailbox.js";
import { createSessionBridgeMcpPlugin } from "./surface.js";
import { createSessionBridgeServices } from "./types.js";

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
      clearAllMailboxReminderWatchers();
    };
  },
};

export default sessionBridgePlugin;
export { createSessionBridgeMcpPlugin };
