import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";

import {
  getAllowedPluginRoots,
  listPluginSummaries,
  loadPluginFromFile,
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

export const ADMIN_BIND_HOST = "127.0.0.1";

type StartPluginAdminServerOptions = {
  port: number;
};

function isLocalAddress(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::ffff:127.0.0.1";
}

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
  return {
    ok: true,
    adminPort,
    allowedRoots: getAllowedPluginRoots(),
    plugins: listPluginSummaries(),
    roots: await listPluginAutoloadRoots(),
  };
}

async function statePayload(adminPort: number) {
  const payload = await fullListPayload(adminPort);
  return {
    adminPort: payload.adminPort,
    allowedRoots: payload.allowedRoots,
    plugins: payload.plugins,
    roots: payload.roots,
  };
}

export async function startLocalPluginAdminServer(
  options: StartPluginAdminServerOptions,
): Promise<Server> {
  await ensureAutoloadPluginsLoaded();

  const server = createServer(async (req, res) => {
    try {
      if (!isLocalAddress(req.socket.remoteAddress)) {
        writeJson(res, 403, { ok: false, error: "forbidden" });
        return;
      }

      const method = req.method || "GET";
      const url = new URL(req.url || "/", `http://${ADMIN_BIND_HOST}:${options.port}`);

      if (url.pathname === "/favicon.ico") {
        res.statusCode = 204;
        res.end();
        return;
      }

      if (method === "GET" && url.pathname === "/") {
        writeHtml(
          res,
          200,
          renderPluginAdminPage({ defaultLoadPath: "_examples/echo-surface" }),
        );
        return;
      }

      if (method === "GET" && url.pathname === "/api/health") {
        writeJson(res, 200, { ok: true, adminPort: options.port, bind: ADMIN_BIND_HOST });
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
        const plugin = await loadPluginFromFile(pluginPath);
        writeJson(res, 200, { ok: true, plugin, ...(await statePayload(options.port)) });
        return;
      }

      if (url.pathname === "/api/plugins/unload") {
        if (method !== "POST") {
          methodNotAllowed(res);
          return;
        }

        const body = await readJsonBody(req);
        const pluginID = typeof body.pluginID === "string" ? body.pluginID.trim() : "";
        const plugin = await unloadPlugin(pluginID);
        writeJson(res, 200, { ok: true, plugin, ...(await statePayload(options.port)) });
        return;
      }

      if (url.pathname === "/api/plugins/reload") {
        if (method !== "POST") {
          methodNotAllowed(res);
          return;
        }

        const body = await readJsonBody(req);
        const pluginID = typeof body.pluginID === "string" ? body.pluginID.trim() : "";
        const plugin = await reloadPlugin(pluginID);
        writeJson(res, 200, { ok: true, plugin, ...(await statePayload(options.port)) });
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
    server.listen(options.port, ADMIN_BIND_HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return server;
}
