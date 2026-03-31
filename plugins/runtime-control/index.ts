import type { OsgServerPlugin } from "@opensessiongateway/server-plugin-sdk";

import { createRuntimeControlMcpPlugin } from "./surface.ts";
import { createRuntimeControlServices } from "./types.ts";

const runtimeControlPlugin: OsgServerPlugin = {
  manifest: {
    id: "runtime-control",
    version: "0.1.0",
    name: "Runtime Control",
    description: "Runtime, session, display, and InstanceWorkspace control MCP surface",
  },
  activate(ctx) {
    ctx.mcp.registerSurface(createRuntimeControlMcpPlugin(createRuntimeControlServices(ctx)));
  },
};

export default runtimeControlPlugin;
export { createRuntimeControlMcpPlugin };
