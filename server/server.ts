import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import type { ParsedUrlQuery } from "node:querystring";
import fs from "node:fs/promises";
import path from "node:path";
import next from "next";
import { WebSocketServer } from "ws";

import { ADMIN_BIND_HOST, startPluginAdminServer } from "./lib/admin-server";
import { ensureAutoloadPluginsLoaded } from "./lib/plugins/mcp/registry";
import { handleV2Upgrade } from "./lib/v2/ws";

const dev = process.env.NODE_ENV !== "production";
const DEFAULT_PORT = 4088;
const DEFAULT_ADMIN_PORT = 4091;
const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_LISTEN_BACKLOG = 511;
const SERVER_RUNTIME_DIR = path.resolve(
  process.env.OSG_SERVER_RUNTIME_DIR?.trim() || path.join(__dirname, "..", "agents", "server", ".runtime"),
);
const LOCK_DIR = path.join(SERVER_RUNTIME_DIR, "locks");

type PortLockState = {
  path: string;
  handle: fs.FileHandle;
};

function resolvePort(): number {
  const value = Number(process.env.PORT || DEFAULT_PORT);
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new Error(`Invalid PORT value: ${process.env.PORT}`);
  }
  return value;
}

function resolveHost(value: string | undefined, fallback = DEFAULT_HOST): string {
  const host = value?.trim();
  return host || fallback;
}

function resolveBacklog(value: string | undefined, fallback = DEFAULT_LISTEN_BACKLOG): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid backlog value: ${value}`);
  }
  return parsed;
}

function resolveAdminPort(): number {
  const value = Number(process.env.OSG_ADMIN_PORT || DEFAULT_ADMIN_PORT);
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new Error(`Invalid OSG_ADMIN_PORT value: ${process.env.OSG_ADMIN_PORT}`);
  }
  return value;
}

async function acquirePortLock(port: number): Promise<PortLockState> {
  await fs.mkdir(LOCK_DIR, { recursive: true });
  const lockPath = path.join(LOCK_DIR, `server-port-${port}.lock`);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, "wx");
      await handle.writeFile(
        `${JSON.stringify({ pid: process.pid, port, createdAt: new Date().toISOString() })}\n`,
        "utf8",
      );
      return { path: lockPath, handle };
    } catch (error) {
      if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }

      let existingPid = 0;
      try {
        const content = await fs.readFile(lockPath, "utf8");
        const parsed = JSON.parse(content || "{}");
        existingPid = Number(parsed.pid) || 0;
      } catch (readError) {
        if (!(readError instanceof Error) || (readError as NodeJS.ErrnoException).code !== "ENOENT") {
          throw readError;
        }
      }

      if (existingPid > 0) {
        if (existingPid === process.pid) {
          try {
            await fs.unlink(lockPath);
          } catch (unlinkError) {
            if (!(unlinkError instanceof Error) || (unlinkError as NodeJS.ErrnoException).code !== "ENOENT") {
              throw unlinkError;
            }
          }
          continue;
        }

        try {
          process.kill(existingPid, 0);
          throw new Error(`Port ${port} is already locked by PID ${existingPid}`);
        } catch (pidError) {
          if (!(pidError instanceof Error) || (pidError as NodeJS.ErrnoException).code !== "ESRCH") {
            throw pidError;
          }
        }
      }

      try {
        await fs.unlink(lockPath);
      } catch (unlinkError) {
        if (!(unlinkError instanceof Error) || (unlinkError as NodeJS.ErrnoException).code !== "ENOENT") {
          throw unlinkError;
        }
      }
    }
  }

  throw new Error(`Unable to acquire lock for port ${port}`);
}

async function releasePortLock(lockState: PortLockState | null): Promise<void> {
  if (!lockState) return;

  try {
    await lockState.handle.close();
  } catch {
  }

  try {
    await fs.unlink(lockState.path);
  } catch {
  }
}

function isV2WsPortPath(pathname: string | null): boolean {
  return pathname === "/api/v2/wsport";
}

function requestPathname(request: IncomingMessage): string | null {
  const host = request.headers.host || `${resolveHost(process.env.OSG_BIND_HOST)}:${resolvePort()}`;
  return new URL(request.url || "/", `http://${host}`).pathname;
}

function toParsedQuery(url: URL): ParsedUrlQuery {
  const query: ParsedUrlQuery = {};
  for (const [key, value] of url.searchParams.entries()) {
    const current = query[key];
    if (typeof current === "undefined") {
      query[key] = value;
      continue;
    }
    if (Array.isArray(current)) {
      current.push(value);
      continue;
    }
    query[key] = [current, value];
  }
  return query;
}

async function bootstrap(): Promise<void> {
  const port = resolvePort();
  const adminPort = resolveAdminPort();
  const hostname = resolveHost(process.env.OSG_BIND_HOST);
  const backlog = resolveBacklog(process.env.OSG_LISTEN_BACKLOG);
  const adminBindHost = resolveHost(process.env.OSG_ADMIN_BIND_HOST, ADMIN_BIND_HOST);
  const adminBacklog = resolveBacklog(process.env.OSG_ADMIN_LISTEN_BACKLOG);
  if (adminPort === port) {
    throw new Error("OSG_ADMIN_PORT must be different from PORT");
  }

  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();

  await app.prepare();
  await ensureAutoloadPluginsLoaded();

  let lockState: PortLockState | null = null;
  let adminLockState: PortLockState | null = null;
  try {
    lockState = await acquirePortLock(port);
    adminLockState = await acquirePortLock(adminPort);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
    return;
  }

  let releasing = false;
  const releaseOnce = async () => {
    if (releasing) return;
    releasing = true;
    await releasePortLock(lockState);
    await releasePortLock(adminLockState);
  };

  process.once("SIGINT", () => {
    releaseOnce().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    releaseOnce().finally(() => process.exit(0));
  });

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || `${hostname}:${port}`}`);
      await handle(req, res, {
        auth: null,
        hash: url.hash || null,
        host: null,
        hostname: null,
        href: `${url.pathname}${url.search}${url.hash}`,
        path: `${url.pathname}${url.search}`,
        pathname: url.pathname,
        port: null,
        protocol: null,
        query: toParsedQuery(url),
        search: url.search || null,
        slashes: null,
      });
    } catch (err) {
      console.error("Error occurred handling", req.url, err);
      res.statusCode = 500;
      res.end("internal server error");
    }
  });

  let adminServer: Awaited<ReturnType<typeof startPluginAdminServer>>;
  try {
    adminServer = await startPluginAdminServer({
      port: adminPort,
      host: adminBindHost,
      backlog: adminBacklog,
    });
  } catch (error) {
    await releaseOnce();
    throw error;
  }
  adminServer.on("close", () => {
    releaseOnce().catch(() => {});
  });
  adminServer.on("error", (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    releaseOnce().finally(() => process.exit(1));
  });

  const wssV2 = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const pathname = requestPathname(request);
    if (isV2WsPortPath(pathname)) {
      wssV2.handleUpgrade(request, socket, head, (ws) => {
        handleV2Upgrade({ request, ws });
      });
      return;
    }
    socket.destroy();
  });

  server.on("close", () => {
    releaseOnce().catch(() => {});
  });

  server.listen({ port, host: hostname, backlog }, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> WebSocket ready on ws://${hostname}:${port}/api/v2/wsport`);
    console.log(`> Plugin admin on http://${adminBindHost}:${adminPort}`);
  });

  server.on("error", (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    releaseOnce().finally(() => process.exit(1));
  });
}

bootstrap().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
