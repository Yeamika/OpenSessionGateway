import fs from "node:fs/promises";
import http from "node:http";

import type { ImBridgeConfig } from "./config.js";
import type { GatewayRoute } from "./types.js";
import { accountKeyOf } from "./types.js";

import {
  type AccountRuntimeEntry,
  HttpError,
  json,
  pipeToResponse,
  readBody,
} from "./app_helpers.js";
import type { StateStore } from "./state.js";

/** Shape that app_http needs from the ImBridgeApp to handle HTTP requests. */
export type AppHttpDeps = {
  readonly config: ImBridgeConfig;
  readonly stateStore: StateStore;
  readonly accountRuntimes: Map<string, AccountRuntimeEntry>;
  readonly logger: {
    warn(message: string, extra?: Record<string, unknown>): void;
  };
  requireUpload(uploadID: string): Promise<import("./types.js").GatewayUpload>;
  requireRoute(routeID: string): Promise<GatewayRoute>;
  requireAccount(providerID: string, accountID: string): Promise<import("./types.js").GatewayAccount>;
  requireAccountRuntime(provider: string, accountID: string): Promise<import("./provider.js").GatewayProviderAccountRuntime>;
  getGatewayInfo(): Promise<Record<string, unknown>>;
};

export async function handleHttpRequest(deps: AppHttpDeps, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || `${deps.config.host}:${deps.config.port}`}`);
    const parts = req.url?.split("/").filter(Boolean).map((item) => decodeURIComponent(item)) || [];
    if (parts.length >= 1 && parts[0] === deps.config.routePrefix) {
      if (parts[1] === "health" && req.method === "GET") {
        json(res, 200, { ok: true, name: "im-gateway-plugin", gateway: await deps.getGatewayInfo() });
        return;
      }
      if (parts[1] === "uploads" && parts[2] && req.method === "POST") {
        await handleUploadWrite(deps, parts[2], req, res);
        return;
      }
      if (parts[1] === "assets" && parts[2] && req.method === "GET") {
        await handleAssetDownload(deps, parts[2], res);
        return;
      }
      if (parts[1] === "webhooks" && parts[2] && parts[3]) {
        await handleProviderWebhook(deps, parts[2], parts[3], req, res);
        return;
      }
    }
    json(res, 404, { ok: false, error: "not_found" });
  } catch (error) {
    if (error instanceof HttpError) {
      json(res, error.status, { ok: false, error: error.code, message: error.message });
      return;
    }
    json(res, 500, { ok: false, error: "internal_error", message: error instanceof Error ? error.message : String(error) });
  }
}

async function handleProviderWebhook(deps: AppHttpDeps, providerID: string, accountID: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const entry = deps.accountRuntimes.get(accountKeyOf(providerID, accountID));
  if (!entry || entry.provider.id !== providerID || !entry.webhookHandler) {
    throw new HttpError(404, "webhook_not_found", `webhook target not found: ${providerID}/${accountID}`);
  }
  await entry.webhookHandler(req, res);
}

async function handleUploadWrite(deps: AppHttpDeps, uploadID: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const upload = await deps.requireUpload(uploadID);
  const body = await readBody(req);
  if (!body.length) throw new HttpError(400, "empty_body", "upload body is required");
  await fs.mkdir(deps.config.uploadDir, { recursive: true });
  await fs.writeFile(upload.localPath, body);
  upload.status = "ready";
  upload.byteLength = body.length;
  upload.fileName = (Array.isArray(req.headers["x-file-name"]) ? req.headers["x-file-name"][0] : req.headers["x-file-name"])?.trim() || `${upload.uploadID}.bin`;
  upload.mimeType = (Array.isArray(req.headers["content-type"]) ? req.headers["content-type"][0] : req.headers["content-type"])?.trim() || "application/octet-stream";
  upload.updatedAt = new Date().toISOString();
  await deps.stateStore.saveUpload(upload, deps.config.uploadCacheLimit);
  json(res, 200, { ok: true, data: { uploadID: upload.uploadID, status: upload.status, byteLength: upload.byteLength, fileName: upload.fileName } });
}

async function handleAssetDownload(deps: AppHttpDeps, assetID: string, res: http.ServerResponse): Promise<void> {
  const asset = await deps.stateStore.getAsset(assetID);
  if (!asset) throw new HttpError(404, "asset_not_found", `asset not found: ${assetID}`);
  const runtime = await deps.requireAccountRuntime(asset.provider, asset.accountID);
  const payload = await runtime.downloadResource(asset.messageID, asset.resourceKey, asset.type);
  res.statusCode = 200;
  await pipeToResponse(res, payload);
}
