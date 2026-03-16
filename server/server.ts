import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { parse } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";
import next from "next";
import { WebSocketServer } from "ws";

import { handleV2Upgrade } from "./lib/v2/ws";

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const DEFAULT_PORT = 4088;
const LOCK_DIR = path.join(__dirname, ".locks");

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
  return parse(request.url || "", true).pathname;
}

async function bootstrap(): Promise<void> {
  const port = resolvePort();
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();

  await app.prepare();

  let lockState: PortLockState | null = null;
  try {
    lockState = await acquirePortLock(port);
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
  };

  process.once("SIGINT", () => {
    releaseOnce().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    releaseOnce().finally(() => process.exit(0));
  });

  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url || "", true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error("Error occurred handling", req.url, err);
      res.statusCode = 500;
      res.end("internal server error");
    }
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

  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> WebSocket ready on ws://${hostname}:${port}/api/v2/wsport`);
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
