import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig, parseArgs } from "../src/config.js";
import { createHttpServer } from "../src/http-server.js";
import { createTimerService } from "../src/timer-store.js";

test("config parser loads defaults and CLI config path", async () => {
  assert.equal(parseArgs(["--config", "timer.json"]).configPath, "timer.json");
  const defaults = await loadConfig("");
  assert.equal(defaults.host, "127.0.0.1");
  assert.equal(defaults.webExecutorSessionID, "timer-web");
});

test("config file reload changes runtime/router/web executor and preserves timers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "timer-config-"));
  const path = join(dir, "timer.json");
  await writeConfig(path, { port: 8801, runtimeID: "rt-a", webSession: "web-a", routerUrl: "" });
  let current = await loadConfig(path);
  const gv = { state: () => ({ status: "disconnected" }), updateConfig: (next) => { current = next; } };
  const manager = { get: () => current, reload: async () => gv.updateConfig(await loadConfig(path)) || current };
  const timers = createTimerService({ onFire: () => {}, scheduler: fakeScheduler() });
  const server = createHttpServer({ configManager: manager, gv, timers });
  await listen(server);
  const base = `http://127.0.0.1:${server.address().port}`;
  await call(base, "CreateOneShotTimer", { runtimeID: "target", sessionID: "session", msg: "x", afterSeconds: 30 });
  await writeConfig(path, { port: 8801, runtimeID: "rt-b", webSession: "web-b", routerUrl: "ws://127.0.0.1:7200" });
  const reloaded = await fetch(`${base}/api/config/reload`, { method: "POST" }).then((r) => r.json());
  const listed = await call(base, "ListRuntimeTimers", { ExecutorSessionID: "caller", runtimeID: "target", sessionID: "session" });
  server.close();
  assert.equal(reloaded.config.runtimeID, "rt-b");
  assert.equal(reloaded.config.webExecutorSessionID, "web-b");
  assert.equal(listed.result.realsize, 1);
});

async function call(base, tool, args) {
  const response = await fetch(`${base}/api/timers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tool, arguments: args }),
  });
  return response.json();
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function writeConfig(path, input) {
  return writeFile(path, JSON.stringify({
    listen: { host: "127.0.0.1", port: input.port },
    gv: { routerUrl: input.routerUrl, runtimeID: input.runtimeID, sessionID: "timer" },
    webExecutor: { runtimeID: "web-rt", sessionID: input.webSession },
  }));
}

function fakeScheduler() {
  return { set: () => ({ fake: true }), clear: () => {} };
}
