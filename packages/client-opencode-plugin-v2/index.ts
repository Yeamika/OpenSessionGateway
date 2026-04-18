import { applyOsgMcpConfig } from "./lib/mcp.js";
import { createQuery } from "./lib/query.js";
import { createTools } from "./lib/tools.js";
import { OSGOpencodeClient } from "./lib/OSG-opencode/index.js";

export const OsgPlugin = async (ctx: any) => {
  const query = createQuery(ctx);
  const osg = new OSGOpencodeClient(ctx, query);

  await osg.start();

  return {
    config: async (config: Record<string, unknown>) => {
      await applyOsgMcpConfig(config, osg.writeLog, () => osg.getRuntimeID(), () => osg.getInstanceWorkspaceDirectoryForMcp(), () => osg.getWsServerUrl());
    },
    tool: createTools(ctx, osg.writeLog),
    event: async ({ event }: { event: any }) => {
      await osg.onEvent(event);
    },
    cleanup() {
      osg.stop();
    },
  };
};

export default OsgPlugin;
