import type {
  PluginContext,
  PluginOsgApi,
  PluginRuntimeClient,
  PluginStorageApi,
} from "@opensessiongateway/server-plugin-sdk";

export type SessionBridgeServices = {
  osg: PluginOsgApi;
  storage: PluginStorageApi;
};

export type SessionBridgeRuntimeClient = PluginRuntimeClient;

export function createSessionBridgeServices(context: PluginContext): SessionBridgeServices {
  return {
    osg: context.osg,
    storage: context.storage,
  };
}
