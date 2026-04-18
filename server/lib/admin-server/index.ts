import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";

import {
  getAllowedPluginRoots,
  listPluginSummaries,
  loadPluginFromFile,
  loadPluginFromPackage,
  reloadPlugin,
  unloadPlugin,
} from "@/lib/plugins/host";
import {
  applyPluginAutoloadConfig,
  ensureAutoloadPluginsLoaded,
  listPluginAutoloadRoots,
  setPluginAutoloadState,
} from "@/lib/plugins/mcp/registry";

import { renderPluginAdminPage } from "./page";

export const ADMIN_BIND_HOST = process.env.OSG_ADMIN_BIND_HOST?.trim() || "127.0.0.1";
const DEFAULT_ADMIN_LISTEN_BACKLOG = 511;

type StartPluginAdminServerOptions = {
  backlog?: number;
  host?: string;
  port: number;
};

function writeJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function writeHtml(res: ServerResponse, status: number, html: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(html);
}

function notFound(res: ServerResponse): void {
  writeJson(res, 404, { ok: false, error: "not found" });
}

function methodNotAllowed(res: ServerResponse): void {
  writeJson(res, 405, { ok: false, error: "method not allowed" });
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];

  await new Promise<void>((resolve, reject) => {
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => resolve());
    req.on("error", reject);
  });

  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};

  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function isPathInside(parentPath: string, targetPath: string): boolean {
  const relative = path.relative(parentPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function fullListPayload(adminPort: number) {
  const plugins = listPluginSummaries().sort((a, b) => a.id.localeCompare(b.id));
  const roots = await listPluginAutoloadRoots();
  return {
    ok: true,
    snapshotAt: new Date().toISOString(),
    adminPort,
    allowedRoots: getAllowedPluginRoots(),
    plugins,
    roots,
  };
}

async function statePayload(adminPort: number) {
  const payload = await fullListPayload(adminPort);
  return {
    snapshotAt: payload.snapshotAt,
    adminPort: payload.adminPort,
    allowedRoots: payload.allowedRoots,
    plugins: payload.plugins,
    roots: payload.roots,
  };
}

export async function startPluginAdminServer(
  options: StartPluginAdminServerOptions,
): Promise<Server> {
  await ensureAutoloadPluginsLoaded();

  const bindHost = options.host?.trim() || ADMIN_BIND_HOST;
  const backlog = typeof options.backlog === "number" ? options.backlog : DEFAULT_ADMIN_LISTEN_BACKLOG;

  const server = createServer(async (req, res) => {
    try {
      const method = req.method || "GET";
      const url = new URL(req.url || "/", `http://${bindHost}:${options.port}`);

      if (url.pathname === "/favicon.ico") {
        res.statusCode = 204;
        res.end();
        return;
      }

      if (method === "GET" && url.pathname === "/") {
        writeHtml(
          res,
          200,
          renderPluginAdminPage(),
        );
        return;
      }

      if (method === "GET" && url.pathname === "/api/health") {
        writeJson(res, 200, {
          ok: true,
          adminPort: options.port,
          bind: bindHost,
        });
        return;
      }

      if (method === "GET" && url.pathname === "/api/plugins") {
        writeJson(res, 200, await fullListPayload(options.port));
        return;
      }

      if (url.pathname === "/api/plugins/load") {
        if (method !== "POST") {
          methodNotAllowed(res);
          return;
        }

        const body = await readJsonBody(req);
        const pluginPath = typeof body.path === "string" ? body.path.trim() : "";
        const packageName = typeof body.packageName === "string" ? body.packageName.trim() : "";
        const loadedPlugin = packageName
          ? await loadPluginFromPackage(packageName)
          : await loadPluginFromFile(pluginPath);
        writeJson(res, 200, { ok: true, loadedPlugin, ...(await statePayload(options.port)) });
        return;
      }

      if (url.pathname === "/api/plugins/unload") {
        if (method !== "POST") {
          methodNotAllowed(res);
          return;
        }

        const body = await readJsonBody(req);
        const pluginID = typeof body.pluginID === "string" ? body.pluginID.trim() : "";
        const unloadedPlugin = await unloadPlugin(pluginID);
        writeJson(res, 200, { ok: true, unloadedPlugin, ...(await statePayload(options.port)) });
        return;
      }

      if (url.pathname === "/api/plugins/reload") {
        if (method !== "POST") {
          methodNotAllowed(res);
          return;
        }

        const body = await readJsonBody(req);
        const pluginID = typeof body.pluginID === "string" ? body.pluginID.trim() : "";
        const reloadedPlugin = await reloadPlugin(pluginID);
        writeJson(res, 200, { ok: true, reloadedPlugin, ...(await statePayload(options.port)) });
        return;
      }

      if (url.pathname === "/api/plugins/autoload") {
        if (method !== "POST") {
          methodNotAllowed(res);
          return;
        }

        const body = await readJsonBody(req);
        const rootPath = typeof body.rootPath === "string" ? body.rootPath.trim() : "";
        const packageName = typeof body.packageName === "string" ? body.packageName.trim() : "";
        const enabled = body.enabled === true;

        const rootSnapshot = await setPluginAutoloadState(rootPath, packageName, enabled);
        const packagePath = path.join(rootPath, packageName);
        const loaded = listPluginSummaries().find((plugin) =>
          plugin.sourcePath ? isPathInside(packagePath, plugin.sourcePath) : false,
        );

        if (enabled && !loaded) {
          try {
            await loadPluginFromFile(packagePath);
          } catch (error) {
            await setPluginAutoloadState(rootPath, packageName, false);
            throw error;
          }
        }

        if (!enabled && loaded) {
          await unloadPlugin(loaded.id);
        }

        writeJson(res, 200, {
          ok: true,
          root: rootSnapshot,
          ...(await statePayload(options.port)),
        });
        return;
      }

      if (url.pathname === "/api/plugins/autoload/apply") {
        if (method !== "POST") {
          methodNotAllowed(res);
          return;
        }

        const result = await applyPluginAutoloadConfig();
        writeJson(res, 200, {
          ok: true,
          result,
          ...(await statePayload(options.port)),
        });
        return;
      }

      notFound(res);
    } catch (error) {
      writeJson(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, bindHost, backlog, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return server;
}
