import { promises as fs } from "node:fs"
import path from "node:path"

const DEFAULT_RUNTIME_ID = "codex"

export async function readCaller() {
  const explicitSession = text(process.env.GV_CODEX_SESSION_ID || process.env.ExecutorSessionID)
  const explicitRuntime = text(process.env.GV_CODEX_RUNTIME_ID || process.env.ExecutorRuntimeID)
  const explicitThread = text(process.env.GV_CODEX_THREAD_ID)
  const explicitCwd = text(process.env.GV_CODEX_CWD)
  if (explicitSession) {
    return {
      sessionID: explicitSession,
      runtimeID: explicitRuntime || DEFAULT_RUNTIME_ID,
      threadID: explicitThread,
      cwd: explicitCwd,
    }
  }

  const stateDir = process.env.GV_CODEX_STATE_DIR || pluginDataPath("state")
  const latest = stateDir ? await readLatestState(stateDir) : null
  return {
    sessionID: text(latest?.sessionID),
    threadID: explicitThread || text(latest?.threadID),
    runtimeID: explicitRuntime || text(process.env.GV_CODEX_RUNTIME) || cwdRuntime(latest?.cwd),
    cwd: explicitCwd || text(latest?.cwd),
  }
}

export function injectedArgs(caller, names) {
  const values = {
    ExecutorRuntimeID: caller.runtimeID,
    ExecutorSessionID: caller.sessionID,
    ExecutorThreadID: caller.threadID,
    runtimeID: caller.runtimeID,
    sessionID: caller.sessionID,
    threadID: caller.threadID,
    cwd: caller.cwd,
  }
  return Object.fromEntries(
    names
      .map((name) => [name, values[name]])
      .filter(([, value]) => value !== undefined && value !== null && value !== ""),
  )
}

async function readLatestState(stateDir) {
  try {
    const entries = await fs.readdir(stateDir, { withFileTypes: true })
    const files = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map(async (entry) => {
        const file = path.join(stateDir, entry.name)
        const stat = await fs.stat(file)
        return { file, mtimeMs: stat.mtimeMs }
      }))
    files.sort((a, b) => b.mtimeMs - a.mtimeMs)
    for (const item of files) {
      const state = parseLastJsonLine(await fs.readFile(item.file, "utf8"))
      if (state?.sessionID) return state
    }
  } catch {}
  return null
}

function parseLastJsonLine(content) {
  const lines = content.trim().split("\n").filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index])
    } catch {}
  }
  return null
}

function pluginDataPath(...segments) {
  const root = process.env.GV_CODEX_STATE_ROOT
    || process.env.PLUGIN_DATA
    || process.env.CODEX_PLUGIN_DATA
    || process.env.CLAUDE_PLUGIN_DATA
  return root ? path.join(root, ...segments) : ""
}

function cwdRuntime(cwd) {
  return text(process.env.GV_CODEX_RUNTIME) || (cwd ? path.basename(cwd) : "") || DEFAULT_RUNTIME_ID
}

function text(value) {
  return typeof value === "string" ? value.trim() : ""
}
