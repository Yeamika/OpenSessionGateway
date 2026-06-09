import path from "node:path"

const DEFAULT_RUNTIME_ID = "codex"

export async function readCaller(context = null) {
  const direct = directContext(context)
  if (direct.sessionID || direct.threadID) {
    const threadID = direct.threadID || direct.sessionID
    const sessionID = direct.sessionID || threadID
    return {
      sessionID,
      threadID,
      rootSessionID: direct.rootSessionID || sessionID,
      turnID: direct.turnID,
      toolUseID: direct.toolUseID,
      runtimeID: direct.runtimeID || cwdRuntime(direct.cwd),
      cwd: direct.cwd,
    }
  }

  const explicitRuntime = text(process.env.GV_CODEX_RUNTIME_ID || process.env.ExecutorRuntimeID)
  const explicitCwd = text(process.env.GV_CODEX_CWD)
  return {
    sessionID: "",
    threadID: "",
    runtimeID: explicitRuntime || text(process.env.GV_CODEX_RUNTIME) || DEFAULT_RUNTIME_ID,
    cwd: explicitCwd,
  }
}

export function injectedArgs(caller, names) {
  const values = {
    ExecutorRuntimeID: caller.runtimeID,
    ExecutorSessionID: caller.sessionID,
    ExecutorThreadID: caller.threadID,
    ExecutorRootSessionID: caller.rootSessionID,
    ExecutorTurnID: caller.turnID,
    ExecutorToolUseID: caller.toolUseID,
    runtimeID: caller.runtimeID,
    sessionID: caller.sessionID,
    threadID: caller.threadID,
    rootSessionID: caller.rootSessionID,
    turnID: caller.turnID,
    toolUseID: caller.toolUseID,
    cwd: caller.cwd,
  }
  return Object.fromEntries(
    names
      .map((name) => [name, values[name]])
      .filter(([, value]) => value !== undefined && value !== null && value !== ""),
  )
}

function directContext(context) {
  const value = context && typeof context === "object" && !Array.isArray(context) ? context : {}
  return {
    sessionID: text(value.sessionID || value.session_id),
    threadID: text(value.threadID || value.thread_id || value.agentID || value.agent_id),
    rootSessionID: text(value.rootSessionID || value.root_session_id),
    turnID: text(value.turnID || value.turn_id),
    toolUseID: text(value.toolUseID || value.tool_use_id),
    runtimeID: text(value.runtimeID || value.runtime_id),
    cwd: text(value.cwd),
  }
}

function cwdRuntime(cwd) {
  return text(process.env.GV_CODEX_RUNTIME) || (cwd ? path.basename(cwd) : "") || DEFAULT_RUNTIME_ID
}

function text(value) {
  return typeof value === "string" ? value.trim() : ""
}
