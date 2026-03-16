import { scheduleMcpSetup } from "./lib/mcp.js";
import { createQuery } from "./lib/query.js";
import { createTools } from "./lib/tools.js";
import { OSGOpencodeClient } from "./lib/OSG-opencode/index.js";

export const OpencodeHookClientV2 = async (ctx: any) => {
  const query = createQuery(ctx);
  const osg = new OSGOpencodeClient(ctx, query);

  await osg.start();

  scheduleMcpSetup(ctx, query, osg.writeLog, () => osg.getRuntimeID(), () => osg.getWsServerUrl());

  return {
    tool: createTools(ctx, query, osg.writeLog),
    event: async ({ event }: { event: any }) => {
      await osg.onEvent(event);
    },
    cleanup() {
      osg.stop();
    },
  };
};

export default OpencodeHookClientV2;
