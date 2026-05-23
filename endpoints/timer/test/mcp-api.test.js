import assert from "node:assert/strict";
import test from "node:test";
import { callTool, handleMcp } from "../src/mcp-api.js";
import { createTimerService } from "../src/timer-store.js";

test("tools/list exposes self and manager timer tools", async () => {
  const timers = createTimerService({ onFire: () => {}, scheduler: fakeScheduler() });
  const manager = await handleMcp({ timers, scope: "manager", runtimeID: "", body: { id: 1, method: "tools/list" } });
  const self = await handleMcp({ timers, scope: "self", runtimeID: "rt", body: { id: 2, method: "tools/list" } });
  assert(manager.result.tools.some((tool) => tool.name === "ListAllTimers"));
  assert(self.result.tools.some((tool) => tool.name === "CreateCronTimer"));
  for (const tool of manager.result.tools) assert(tool.inputSchema.required.includes("ExecutorSessionID"), tool.name);
  for (const tool of self.result.tools) assert(tool.inputSchema.required.includes("ExecutorSessionID"), tool.name);
  const create = manager.result.tools.find((tool) => tool.name === "CreateOneShotTimer");
  assert(create.inputSchema.required.includes("sessionID"));
  assert(create.inputSchema.properties.ExecutorSessionID.description.includes("Caller"));
});

test("manager tools/call covers create, list all, delete, and missing delete", async () => {
  const timers = createTimerService({ onFire: () => {}, scheduler: fakeScheduler() });
  const audit = { ExecutorRuntimeID: "caller-rt", ExecutorSessionID: "caller-s" };
  const created = await callTool({ timers, scope: "manager", runtimeID: "", name: "CreateOneShotTimer", args: { ...audit, runtimeID: "rt", sessionID: "s", msg: "x", afterSeconds: 30 } });
  assert(created.TimerID);
  assert.equal(created.SessionID, "s");
  assert.equal(created.ExecutorSessionID, "caller-s");
  assert.equal((await callTool({ timers, scope: "manager", runtimeID: "", name: "ListAllTimers", args: audit })).realsize, 1);
  assert.equal((await callTool({ timers, scope: "manager", runtimeID: "", name: "DeleteRuntimeTimer", args: { ...audit, runtimeID: "rt", sessionID: "other", timerID: created.TimerID } })).deleted, false);
  assert.equal((await callTool({ timers, scope: "manager", runtimeID: "", name: "DeleteRuntimeTimer", args: { ...audit, runtimeID: "rt", sessionID: "s", timerID: created.TimerID } })).deleted, true);
});

test("self tools/call maps ExecutorSessionID to runtime/session scope", async () => {
  const timers = createTimerService({ onFire: () => {}, scheduler: fakeScheduler() });
  const response = await handleMcp({
    timers,
    scope: "self",
    runtimeID: "rt-self",
    body: { id: 1, method: "tools/call", params: { name: "CreatePeriodicTimer", arguments: { ExecutorSessionID: "s-self", msg: "tick", everySeconds: 3 } } },
  });
  assert.equal(response.error, undefined);
  const list = await callTool({ timers, scope: "self", runtimeID: "rt-self", name: "ListRuntimeTimers", args: { ExecutorSessionID: "s-self" } });
  assert.equal(list.realsize, 1);
  assert.equal(list.list[0].RuntimeID, "rt-self");
  assert.equal(list.list[0].SessionID, "s-self");
  assert.equal(list.list[0].ExecutorSessionID, "s-self");
});

test("manager target sessionID is distinct from ExecutorSessionID and missing executor is clear", async () => {
  const timers = createTimerService({ onFire: () => {}, scheduler: fakeScheduler() });
  const missing = await handleMcp({
    timers,
    scope: "manager",
    runtimeID: "",
    body: { id: 1, method: "tools/call", params: { name: "ListRuntimeTimers", arguments: { runtimeID: "target-rt", sessionID: "target-s" } } },
  });
  assert.match(missing.error.message, /ExecutorSessionID is required/);
  const created = await callTool({
    timers,
    scope: "manager",
    runtimeID: "",
    name: "CreateOneShotTimer",
    args: { ExecutorSessionID: "caller-s", runtimeID: "target-rt", sessionID: "target-s", msg: "x", afterSeconds: 1 },
  });
  assert.equal(created.SessionID, "target-s");
  assert.equal(created.ExecutorSessionID, "caller-s");
});

test("tools/call returns JSON-RPC errors for invalid tool/input", async () => {
  const timers = createTimerService({ onFire: () => {}, scheduler: fakeScheduler() });
  const unknown = await handleMcp({ timers, scope: "manager", runtimeID: "", body: { id: 1, method: "tools/call", params: { name: "Nope", arguments: {} } } });
  const invalid = await handleMcp({ timers, scope: "manager", runtimeID: "", body: { id: 2, method: "tools/call", params: { name: "CreateCronTimer", arguments: { ExecutorSessionID: "caller", runtimeID: "rt", sessionID: "s", msg: "x", cronExpr: "* *" } } } });
  assert.equal(unknown.error.code, -32602);
  assert.equal(invalid.error.code, -32602);
});

function fakeScheduler() {
  return { set: () => ({ fake: true }), clear: () => {} };
}
