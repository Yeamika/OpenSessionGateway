import type {
  PluginContext,
  PluginOsgApi,
  PluginRuntimeClient,
  PluginStorageApi,
} from "@opensessiongateway/server-plugin-sdk";

export type SessionBridgeServices = {
  osg: Omit<PluginOsgApi, "getSessionMessages"> & {
    getSessionMessages: (payload: {
      runtimeID: string;
      sessionID: string;
      size?: number;
      regex?: string;
      anchorTime?: string;
    }) => Promise<{ runtimeID: string; sessionID: string; realsize: number; list: Array<Record<string, unknown>> }>;
  };
  storage: PluginStorageApi;
  watchSessionStatus: PluginContext["hooks"]["onSessionStatusChange"];
  log: PluginContext["log"];
};

export type SessionBridgeRuntimeClient = PluginRuntimeClient;

export function createSessionBridgeServices(context: PluginContext): SessionBridgeServices {
  return {
    osg: context.osg,
    storage: context.storage,
    watchSessionStatus: context.hooks.onSessionStatusChange,
    log: context.log,
  };
}
