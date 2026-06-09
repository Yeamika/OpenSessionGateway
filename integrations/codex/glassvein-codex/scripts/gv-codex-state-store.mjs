import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"

const STATE_DB_RE = /^state_(\d+)\.sqlite$/

export async function recordCodexSessionBinding(state) {
  if (!boolEnv("GV_CODEX_BINDINGS", true)) return { status: "disabled" }

  const sessionID = text(state?.sessionID || state?.threadID || process.env.CODEX_THREAD_ID)
  if (!sessionID) return { status: "skipped" }

  const dbPath = await codexStateDbPath({ forWrite: true })
  if (!dbPath) return { status: "unavailable" }

  return withCodexDb(dbPath, (db) => {
    ensureBindingTable(db)
    const requestedThreadID = text(state?.threadID || process.env.CODEX_THREAD_ID || sessionID)
    const codexThread = readCodexThread(db, requestedThreadID) || readCodexThread(db, sessionID)
    const threadID = text(codexThread?.id || requestedThreadID)
    const cwd = text(state?.cwd || codexThread?.cwd)
    const runtimeID = text(state?.runtimeID || process.env.GV_CODEX_RUNTIME_ID || process.env.GV_CODEX_RUNTIME) || cwdRuntime(cwd)
    const now = Date.now()

    db.prepare(`
      INSERT INTO gv_session_bindings (
        thread_id,
        session_id,
        runtime_id,
        cwd,
        source,
        codex_rollout_path,
        created_at_ms,
        updated_at_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET
        session_id = excluded.session_id,
        runtime_id = excluded.runtime_id,
        cwd = excluded.cwd,
        source = excluded.source,
        codex_rollout_path = excluded.codex_rollout_path,
        updated_at_ms = excluded.updated_at_ms
    `).run(
      threadID,
      sessionID,
      runtimeID,
      cwd,
      text(codexThread?.source),
      text(codexThread?.rollout_path),
      now,
      now,
    )

    return { status: "written", path: dbPath, threadID, sessionID }
  })
}

export async function resolveCodexSessionBinding({ sessionID, threadID } = {}) {
  if (!boolEnv("GV_CODEX_BINDINGS", true)) return null

  const dbPath = await codexStateDbPath({ forWrite: false })
  if (!dbPath) return null

  try {
    return await withCodexDb(dbPath, (db) => {
      const binding = readBinding(db, { sessionID, threadID })
      if (binding?.sessionID) return binding

      const codexThread = readCodexThread(db, text(threadID || sessionID))
      if (!codexThread?.id) return null
      const cwd = text(codexThread.cwd)
      return clean({
        threadID: codexThread.id,
        sessionID: codexThread.id,
        runtimeID: cwdRuntime(cwd),
        cwd,
        source: text(codexThread.source),
        codexRolloutPath: text(codexThread.rollout_path),
      })
    })
  } catch {
    return null
  }
}

export async function codexStateDbPath({ forWrite = false } = {}) {
  const explicit = text(process.env.GV_CODEX_STATE_DB || process.env.GV_CODEX_SQLITE_DB)
  if (explicit) {
    if (forWrite) return explicit
    return await exists(explicit) ? explicit : null
  }

  const sqliteHome = await codexSqliteHome()
  return await latestStateDb(sqliteHome)
}

async function codexSqliteHome() {
  const fromConfig = await configuredSqliteHome()
  if (fromConfig) return resolveFromCwd(fromConfig)

  const fromEnv = text(process.env.CODEX_SQLITE_HOME)
  if (fromEnv) return resolveFromCwd(fromEnv)

  return codexHome()
}

async function configuredSqliteHome() {
  const configFile = path.join(codexHome(), "config.toml")
  try {
    const content = await fs.readFile(configFile, "utf8")
    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim()
      if (!line || line.startsWith("#")) continue
      const match = /^sqlite_home\s*=\s*(.+?)\s*(?:#.*)?$/.exec(line)
      if (match) return tomlString(match[1])
    }
  } catch {}
  return ""
}

function codexHome() {
  return resolveFromCwd(text(process.env.CODEX_HOME) || path.join(os.homedir(), ".codex"))
}

async function latestStateDb(dir) {
  try {
    const entries = await fs.readdir(dir)
    const matches = entries
      .map((name) => {
        const match = STATE_DB_RE.exec(name)
        return match ? { name, version: Number.parseInt(match[1], 10) } : null
      })
      .filter(Boolean)
      .sort((a, b) => b.version - a.version)
    return matches[0] ? path.join(dir, matches[0].name) : ""
  } catch {
    return ""
  }
}

async function withCodexDb(dbPath, fn) {
  const sqlite = await loadSqlite()
  if (!sqlite?.DatabaseSync) return { status: "unavailable" }

  let db
  try {
    db = new sqlite.DatabaseSync(dbPath)
    db.exec("PRAGMA busy_timeout = 1500")
    return fn(db)
  } catch (error) {
    return { status: "failed", error: errorMessage(error) }
  } finally {
    try {
      db?.close()
    } catch {}
  }
}

async function loadSqlite() {
  try {
    return await import("node:sqlite")
  } catch {
    return null
  }
}

function ensureBindingTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gv_session_bindings (
      thread_id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL,
      runtime_id TEXT,
      cwd TEXT,
      source TEXT,
      codex_rollout_path TEXT,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gv_session_bindings_session
      ON gv_session_bindings(session_id);
  `)
}

function readBinding(db, { sessionID, threadID }) {
  try {
    if (text(threadID)) {
      const row = db.prepare("SELECT * FROM gv_session_bindings WHERE thread_id = ?").get(text(threadID))
      if (row) return bindingFromRow(row)
    }
    if (text(sessionID)) {
      const row = db.prepare("SELECT * FROM gv_session_bindings WHERE session_id = ? ORDER BY updated_at_ms DESC LIMIT 1").get(text(sessionID))
      if (row) return bindingFromRow(row)
    }
  } catch {}
  return null
}

function readCodexThread(db, threadID) {
  if (!text(threadID)) return null
  try {
    return db.prepare("SELECT id, rollout_path, cwd, source FROM threads WHERE id = ?").get(text(threadID)) || null
  } catch {
    return null
  }
}

function bindingFromRow(row) {
  return clean({
    threadID: text(row.thread_id),
    sessionID: text(row.session_id),
    runtimeID: text(row.runtime_id),
    cwd: text(row.cwd),
    source: text(row.source),
    codexRolloutPath: text(row.codex_rollout_path),
  })
}

function tomlString(raw) {
  const value = raw.trim()
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

async function exists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

function resolveFromCwd(value) {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value)
}

function cwdRuntime(cwd) {
  return text(process.env.GV_CODEX_RUNTIME) || (cwd ? path.basename(cwd) : "") || "codex"
}

function clean(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ""))
}

function boolEnv(name, defaultValue) {
  const raw = process.env[name]
  if (raw == null || raw === "") return defaultValue
  return /^(1|true|yes|on)$/i.test(raw)
}

function text(value) {
  return typeof value === "string" ? value.trim() : ""
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
