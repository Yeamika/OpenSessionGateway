import type { OsgServerPlugin } from "@opensessiongateway/server-plugin-sdk";

import { ImBridgeApp } from "./src/app.ts";
import { loadConfig } from "./src/config.ts";
import { createImBridgeSurface } from "./src/surface.ts";

const plugin: OsgServerPlugin = {
  manifest: {
    id: "im-gateway",
    version: "0.1.0",
    name: "IM Gateway",
    description: "Multi-route IM gateway with pluggable providers",
  },
  async activate(ctx) {
    const app = new ImBridgeApp(loadConfig(), ctx);
    ctx.mcp.registerSurface(createImBridgeSurface(app));
    await app.start();
    return async () => {
      await app.stop();
    };
  },
};

export default plugin;
