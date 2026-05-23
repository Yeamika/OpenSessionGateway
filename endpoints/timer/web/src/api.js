export async function loadStatus() {
  return request("/api/status");
}

export async function callTimerTool(tool, args) {
  return request("/api/timers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tool, arguments: args }),
  });
}

export function listArgs(state) {
  if (state.listAll) return { tool: "ListAllTimers", args: {} };
  return { tool: "ListRuntimeTimers", args: { runtimeID: state.runtimeID, sessionID: state.sessionID } };
}

export function createArgs(state, input) {
  const base = { runtimeID: state.runtimeID, sessionID: state.sessionID, title: input.title, msg: input.msg };
  if (input.timerType === "periodic") return { tool: "CreatePeriodicTimer", args: { ...base, everySeconds: input.everySeconds } };
  if (input.timerType === "cron") return { tool: "CreateCronTimer", args: { ...base, cronExpr: input.cronExpr } };
  return { tool: "CreateOneShotTimer", args: { ...base, afterSeconds: input.afterSeconds } };
}

export function deleteArgs(state, timer) {
  return {
    tool: "DeleteRuntimeTimer",
    args: { runtimeID: timer.RuntimeID || state.runtimeID, sessionID: timer.SessionID || state.sessionID, timerID: timer.TimerID },
  };
}

async function request(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error || response.statusText);
  return payload;
}
