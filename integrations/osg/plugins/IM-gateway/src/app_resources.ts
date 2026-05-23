import fs from "node:fs/promises";
import path from "node:path";

import type { GatewayProviderAccountRuntime } from "./provider.js";
import type { GatewayAsset, GatewayInboundEvent, GatewayMessageSummary, GatewayResourceType, GatewayRoute, GatewayRouteStatus, GatewayUpload } from "./types.js";

import {
  type AccountRuntimeEntry,
  buildAssetID,
  buildUploadID,
  publicHost,
  publicMessage,
  publicRoute,
  requireString,
  requireType,
} from "./app_helpers.js";
import type { ImBridgeConfig } from "./config.js";
import type { StateStore } from "./state.js";

export type AppResourceDeps = {
  readonly config: ImBridgeConfig;
  readonly stateStore: StateStore;
  readonly accountRuntimes: Map<string, AccountRuntimeEntry>;
  readonly logger: {
    warn(message: string, extra?: Record<string, unknown>): void;
  };
  requireRoute(routeID: string): Promise<GatewayRoute>;
  requireUpload(uploadID: string): Promise<GatewayUpload>;
  requireAccountRuntime(provider: string, accountID: string): Promise<GatewayProviderAccountRuntime>;
  requireRouteMessage(route: GatewayRoute, messageID: string): Promise<GatewayMessageSummary>;
  refreshRouteMessages(route: GatewayRoute, limit: number): Promise<void>;
};

export function buildUploadUrl(config: ImBridgeConfig, uploadID: string): string {
  const host = publicHost(config.host);
  return `http://${host}:${config.port}/${config.routePrefix}/uploads/${encodeURIComponent(uploadID)}`;
}

export function buildAssetUrl(config: ImBridgeConfig, assetID: string): string {
  const host = publicHost(config.host);
  return `http://${host}:${config.port}/${config.routePrefix}/assets/${encodeURIComponent(assetID)}`;
}

export async function listRouteMessages(deps: AppResourceDeps, routeID: string, options?: { limit?: number; refresh?: boolean }) {
  const route = await deps.requireRoute(routeID);
  const limit = Math.min(50, Math.max(1, Math.floor(options?.limit || deps.config.messagePageSize)));
  if (options?.refresh !== false) {
    await deps.refreshRouteMessages(route, limit).catch((error) => {
      deps.logger.warn("route message refresh failed", { routeID: route.routeID, message: error instanceof Error ? error.message : String(error) });
    });
  }
  const items = await deps.stateStore.getRouteMessages(route.routeID);
  return { routeID: route.routeID, count: Math.min(limit, items.length), items: items.slice(0, limit).map(publicMessage) };
}

export async function sendRouteTextMessage(deps: AppResourceDeps, routeID: string, text: string) {
  const route = await deps.requireRoute(routeID);
  const runtime = await deps.requireAccountRuntime(route.provider, route.accountID);
  const result = await runtime.sendTextMessage(route.chatID, requireString(text, "text"));
  await deps.refreshRouteMessages(route, deps.config.messagePageSize).catch(() => undefined);
  return { routeID: route.routeID, ...result };
}

export async function requestUpload(deps: AppResourceDeps, input: { type: "image" | "file"; routeID?: string }) {
  const uploadID = buildUploadID();
  const routeID = input.routeID?.trim() || "";
  if (routeID) await deps.requireRoute(routeID);
  const upload: GatewayUpload = {
    uploadID,
    routeID,
    type: input.type,
    fileName: "",
    mimeType: "",
    localPath: path.join(deps.config.uploadDir, `${uploadID}.bin`),
    byteLength: 0,
    status: "pending",
    providerRefs: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await deps.stateStore.saveUpload(upload, deps.config.uploadCacheLimit);
  return {
    uploadID,
    routeID: upload.routeID || null,
    type: upload.type,
    method: "POST",
    uploadURL: buildUploadUrl(deps.config, uploadID),
  };
}

export async function sendRouteUpload(deps: AppResourceDeps, routeID: string, uploadID: string) {
  const route = await deps.requireRoute(routeID);
  const upload = await deps.requireUpload(uploadID);
  if (upload.routeID && upload.routeID !== route.routeID) {
    throw new Error(`uploadID is bound to another route: ${upload.routeID}`);
  }
  if (upload.status !== "ready" || !upload.localPath) throw new Error(`uploadID is not ready: ${upload.uploadID}`);
  const runtime = await deps.requireAccountRuntime(route.provider, route.accountID);
  const providerRefKey = `${route.provider}::${route.accountID}`;
  let providerRef = upload.providerRefs[providerRefKey] || null;
  if (!providerRef) {
    const content = await fs.readFile(upload.localPath);
    const resourceKey = upload.type === "image"
      ? await runtime.uploadImage(upload.fileName || `${upload.uploadID}.bin`, content, upload.mimeType)
      : await runtime.uploadFile(upload.fileName || `${upload.uploadID}.bin`, content, upload.mimeType);
    providerRef = {
      provider: route.provider,
      accountID: route.accountID,
      resourceType: upload.type,
      resourceKey,
      uploadedAt: new Date().toISOString(),
    };
    upload.providerRefs[providerRefKey] = providerRef;
    upload.routeID = upload.routeID || route.routeID;
    upload.updatedAt = new Date().toISOString();
    await deps.stateStore.saveUpload(upload, deps.config.uploadCacheLimit);
  }
  const result = providerRef.resourceType === "image"
    ? await runtime.sendImageMessage(route.chatID, providerRef.resourceKey)
    : await runtime.sendFileMessage(route.chatID, providerRef.resourceKey);
  await deps.refreshRouteMessages(route, deps.config.messagePageSize).catch(() => undefined);
  return { routeID: route.routeID, ...result, uploadID: upload.uploadID };
}

export async function requestDownload(deps: AppResourceDeps, input: { routeID: string; messageID: string; type: GatewayResourceType }) {
  const route = await deps.requireRoute(input.routeID);
  const message = await deps.requireRouteMessage(route, requireString(input.messageID, "messageID"));
  const type = requireType(input.type, "type") as GatewayResourceType;
  if (!message.resourceType || !message.resourceKey) throw new Error(`message has no downloadable resource: ${message.messageID}`);
  if (message.resourceType !== type) throw new Error(`message resource type mismatch: expected ${type}, got ${message.resourceType}`);
  const asset: GatewayAsset = {
    assetID: buildAssetID(),
    routeID: route.routeID,
    provider: route.provider,
    accountID: route.accountID,
    chatID: route.chatID,
    messageID: message.messageID,
    type,
    resourceKey: message.resourceKey,
    createdAt: new Date().toISOString(),
  };
  await deps.stateStore.saveAsset(asset, deps.config.assetCacheLimit);
  return {
    assetID: asset.assetID,
    routeID: asset.routeID,
    type: asset.type,
    downloadURL: buildAssetUrl(deps.config, asset.assetID),
  };
}

export async function listRecentRouteEvents(deps: AppResourceDeps, routeID: string, limit: number) {
  await deps.requireRoute(routeID);
  const items = await deps.stateStore.listRecentInboundEvents(routeID, limit);
  return { routeID, count: items.length, items };
}
