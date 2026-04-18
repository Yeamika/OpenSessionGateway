import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

type FleetConfig = {
  baseUrl: string;
  runtimeCount: number;
  workspaceCount: number;
  sessionsPerWorkspace: number;
  connectTimeoutMs: number;
  baseDirectory: string;
  runtimePrefix: string;
  workspacePrefix: string;
  hostPrefix: string;
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

type JsonLine = Record<string, unknown>;

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function int(value: unknown, fallback: number, min = 1): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) return fallback;
  return parsed;
}

function currentDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

function defaultFleetBaseDir(): string {
  return path.resolve(currentDir(), "..", "..", "agents", "opencode-plug", ".runtime", "workspaces", "client-template-fleet");
}

function configFromEnv(): FleetConfig {
  return {
    baseUrl: text(process.env.OSG_BASE_URL, "http://127.0.0.1:4088/api/v2"),
    runtimeCount: int(process.env.OSG_FLEET_RUNTIME_COUNT, 4),
    workspaceCount: int(process.env.OSG_FLEET_WORKSPACE_COUNT, 3),
    sessionsPerWorkspace: int(process.env.OSG_FLEET_SESSIONS_PER_WORKSPACE, 4),
    connectTimeoutMs: int(process.env.OSG_FLEET_CONNECT_TIMEOUT_MS, 8000, 1000),
    baseDirectory: path.resolve(text(process.env.OSG_FLEET_BASE_DIR, defaultFleetBaseDir())),
    runtimePrefix: text(process.env.OSG_FLEET_RUNTIME_PREFIX, "shoal-runtime"),
    workspacePrefix: text(process.env.OSG_FLEET_WORKSPACE_PREFIX, "reef"),
    hostPrefix: text(process.env.OSG_FLEET_HOST_PREFIX, "client-template-fleet"),
  };
}

class TemplateControlClient {
  child: ChildProcessWithoutNullStreams;
  runtimeID: string;
  hostName: string;
  pending = new Map<string | number, Pending>();

  constructor(input: { runtimeID: string; hostName: string; baseUrl: string }) {
    this.runtimeID = input.runtimeID;
    this.hostName = input.hostName;
    const scriptPath = path.resolve(currentDir(), "script-control.js");
    this.child = spawn(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "inherit"],
      env: {
        ...process.env,
        OSG_BASE_URL: input.baseUrl,
        OSG_RUNTIME_ID: input.runtimeID,
        OSG_HOST_NAME: input.hostName,
        OSG_TEMPLATE_DISABLE_BOOTSTRAP: "1",
      },
    });

    const rl = readline.createInterface({ input: this.child.stdout });
    rl.on("line", (line) => {
      let payload: JsonLine;
      try {
        payload = JSON.parse(line) as JsonLine;
      } catch {
        return;
      }

      if (payload.channel === "response") {
        const id = payload.id as string | number | null;
        if (id === null || typeof id === "undefined") return;
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        if (payload.ok === true) {
          pending.resolve(payload.result);
        } else {
          pending.reject(new Error(text(payload.error, "unknown control error")));
        }
        return;
      }

      if (payload.channel === "event" && payload.event === "fatal") {
        const message = text(payload.message, `fatal error in ${this.runtimeID}`);
        for (const [, pending] of this.pending) {
          pending.reject(new Error(message));
        }
        this.pending.clear();
      }
    });

    this.child.on("exit", (code) => {
      for (const [, pending] of this.pending) {
        pending.reject(new Error(`control client exited: ${this.runtimeID} (${code ?? 0})`));
      }
      this.pending.clear();
    });
  }

  call(op: string, args: Record<string, unknown> = {}) {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${JSON.stringify({ id, op, args })}\n`);
    });
  }

  async shutdown(): Promise<void> {
    try {
      await this.call("shutdown", {});
    } catch {
    }
    this.child.kill();
  }
}

async function seedRuntime(client: TemplateControlClient, config: FleetConfig, runtimeIndex: number): Promise<void> {
  await client.call("waitConnected", { timeoutMs: config.connectTimeoutMs });
  const runtimeDir = path.join(config.baseDirectory, `${config.runtimePrefix}-${runtimeIndex + 1}`);

  for (let workspaceIndex = 0; workspaceIndex < config.workspaceCount; workspaceIndex += 1) {
    const workspaceDir = path.join(runtimeDir, `${config.workspacePrefix}-${workspaceIndex + 1}`);
    await fs.mkdir(workspaceDir, { recursive: true });

    for (let sessionIndex = 0; sessionIndex < config.sessionsPerWorkspace; sessionIndex += 1) {
      await client.call("createNewSession", {
        directory: workspaceDir,
        title: `${client.hostName} / ${config.workspacePrefix}-${workspaceIndex + 1} / session-${sessionIndex + 1}`,
        content: `[fleet seed] runtime ${runtimeIndex + 1}, workspace ${workspaceIndex + 1}, session ${sessionIndex + 1}`,
        model: "openai/gpt-4.1-mini",
        displayID: `display_${runtimeIndex + 1}_${workspaceIndex + 1}`,
      });
    }
  }
}

async function run() {
  const config = configFromEnv();
  await fs.mkdir(config.baseDirectory, { recursive: true });

  const clients: TemplateControlClient[] = [];
  try {
    for (let runtimeIndex = 0; runtimeIndex < config.runtimeCount; runtimeIndex += 1) {
      const runtimeID = `${config.runtimePrefix}-${runtimeIndex + 1}`;
      const hostName = `${config.hostPrefix}-${runtimeIndex + 1}`;
      clients.push(new TemplateControlClient({ runtimeID, hostName, baseUrl: config.baseUrl }));
    }

    for (let runtimeIndex = 0; runtimeIndex < clients.length; runtimeIndex += 1) {
      await seedRuntime(clients[runtimeIndex], config, runtimeIndex);
    }

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        message: "client-template fleet ready",
        baseUrl: config.baseUrl,
        runtimeCount: config.runtimeCount,
        workspaceCount: config.workspaceCount,
        sessionsPerWorkspace: config.sessionsPerWorkspace,
        totalSessions: config.runtimeCount * config.workspaceCount * config.sessionsPerWorkspace,
        baseDirectory: config.baseDirectory,
      }, null, 2)}\n`,
    );

    process.stdout.write("Press Ctrl+C to stop the template fleet.\n");

    const shutdown = async () => {
      for (const client of clients) {
        await client.shutdown();
      }
      process.exit(0);
    };

    process.on("SIGINT", () => {
      void shutdown();
    });
    process.on("SIGTERM", () => {
      void shutdown();
    });
  } catch (error) {
    for (const client of clients) {
      await client.shutdown();
    }
    throw error;
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});
