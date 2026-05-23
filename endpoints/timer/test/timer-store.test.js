import assert from "node:assert/strict";
import test from "node:test";
import { nextCronTriggerAt } from "../src/cron.js";
import { createTimerService } from "../src/timer-store.js";

test("one-shot create, list, fire, and delete lifecycle", async () => {
  const fired = [];
  const service = createTimerService({ onFire: (timer) => fired.push(timer), scheduler: fakeScheduler() });
  const row = service.create({ runtimeID: "rt", sessionID: "s1", msg: "hello", afterSeconds: 5 });
  assert.equal(row.TimerType, "one_shot");
  assert.equal(service.list({ runtimeID: "rt", sessionID: "s1" }).length, 1);
  await service.fireNow(row.TimerID);
  assert.equal(fired.length, 1);
  assert.equal(service.list({ runtimeID: "rt", sessionID: "s1" }).length, 0);
});

test("periodic timer stays after fire and can be deleted", async () => {
  const service = createTimerService({ onFire: () => {}, scheduler: fakeScheduler() });
  const row = service.create({ runtimeID: "rt", sessionID: "s1", msg: "tick", timerType: "periodic", everySeconds: 7 });
  await service.fireNow(row.TimerID);
  assert.equal(service.get(row.TimerID).TimerType, "periodic");
  assert.equal(service.deleteTimer({ runtimeID: "rt", sessionID: "s1", timerID: row.TimerID }).deleted, true);
  assert.equal(service.get(row.TimerID), null);
});

test("cron parser validates fields and computes next trigger", () => {
  assert.equal(nextCronTriggerAt("*/15 * * * *", Date.UTC(2026, 0, 1, 0, 0, 1)), "2026-01-01T00:15:00.000Z");
  assert.throws(() => nextCronTriggerAt("60 * * * *", Date.now()), /minute/);
  assert.throws(() => nextCronTriggerAt("* * *", Date.now()), /exactly 5 fields/);
});

test("runtime/session scope isolates list and delete", () => {
  const service = createTimerService({ onFire: () => {}, scheduler: fakeScheduler() });
  const a = service.create({ runtimeID: "rt-a", sessionID: "s1", msg: "a", afterSeconds: 10 });
  service.create({ runtimeID: "rt-b", sessionID: "s1", msg: "b", afterSeconds: 10 });
  assert.equal(service.list({ runtimeID: "rt-a", sessionID: "s1" }).length, 1);
  assert.equal(service.list().length, 2);
  assert.equal(service.deleteTimer({ runtimeID: "rt-b", sessionID: "s1", timerID: a.TimerID }).deleted, false);
  assert.equal(service.deleteTimer({ runtimeID: "rt-a", sessionID: "s1", timerID: a.TimerID }).deleted, true);
});

test("parameter validation rejects invalid timer inputs", () => {
  const service = createTimerService({ onFire: () => {}, scheduler: fakeScheduler() });
  assert.throws(() => service.create({ runtimeID: "rt", sessionID: "s", msg: "", afterSeconds: 1 }), /msg is required/);
  assert.throws(() => service.create({ runtimeID: "rt", sessionID: "s", msg: "x", afterSeconds: 0 }), /afterSeconds/);
  assert.throws(() => service.create({ runtimeID: "rt", sessionID: "s", msg: "x", timerType: "periodic", everySeconds: -1 }), /everySeconds/);
  assert.throws(() => service.create({ runtimeID: "rt", sessionID: "s", msg: "x", timerType: "cron", cronExpr: "bad" }), /cronExpr/);
});

function fakeScheduler() {
  return { set: () => ({ fake: true }), clear: () => {} };
}
