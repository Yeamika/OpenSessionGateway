import type { OsgServerPlugin } from "@opensessiongateway/server-plugin-sdk";

import { ImBridgeApp } from "./src/app.js";
import { loadConfig } from "./src/config.js";
import { createImGatewayChatSurface, createImGatewayControlSurface } from "./src/surface.js";

const plugin: OsgServerPlugin = {
  manifest: {
    id: "im-gateway",
    version: "0.1.0",
    name: "IM Gateway",
    description: "Multi-route IM gateway with pluggable providers",
  },
  async activate(ctx) {
    const app = new ImBridgeApp(loadConfig(), ctx);
    ctx.mcp.registerSurface(createImGatewayControlSurface(app));
    ctx.mcp.registerSurface(createImGatewayChatSurface(app));
    await app.start();
    return async () => {
      await app.stop();
    };
  },
};

export default plugin;
