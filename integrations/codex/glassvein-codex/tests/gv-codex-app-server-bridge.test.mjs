import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import { resolveAppServerThreadId } from "../scripts/gv-codex-app-server-bridge.mjs"

test("app-server auto mode creates isolated Codex threads per GV session", async () => {
  const temp = mkdtempSync(path.join(tmpdir(), "gv-codex-app-server-"))
  const env = withThreadMap(temp)
  try {
    const client = fakeClient(["codex-thread-a", "codex-thread-b"])
    const callerA = caller("gv-session-a", "hook-thread-a")
    const callerB = caller("gv-session-b", "hook-thread-b")

    assert.equal(await resolveAppServerThreadId(client, callerA, { threadMode: "auto" }), "codex-thread-a")
    assert.equal(await resolveAppServerThreadId(client, callerB, { threadMode: "auto" }), "codex-thread-b")
    assert.equal(await resolveAppServerThreadId(client, callerA, { threadMode: "auto" }), "codex-thread-a")

    assert.deepEqual(client.requests.map((request) => request.method), [
      "thread/start",
      "thread/start",
      "thread/resume",
    ])
    assert.equal(client.requests[2].params.threadId, "codex-thread-a")
    assert.deepEqual(readThreadMap(env.threadMapFile), {
      "gv-session-a": "codex-thread-a",
      "gv-session-b": "codex-thread-b",
    })
  } finally {
    restoreEnv(env)
    rmSync(temp, { recursive: true, force: true })
  }
})

test("app-server existing mode does not create a missing Codex thread", async () => {
  const temp = mkdtempSync(path.join(tmpdir(), "gv-codex-app-server-"))
  const env = withThreadMap(temp)
  try {
    const client = fakeClient([])
    await assert.rejects(
      () => resolveAppServerThreadId(client, { sessionID: "gv-session" }, {}),
      /No Codex app-server thread binding/,
    )
    assert.deepEqual(client.requests, [])
  } finally {
    restoreEnv(env)
    rmSync(temp, { recursive: true, force: true })
  }
})

test("app-server resume mode resumes an explicit Codex thread", async () => {
  const temp = mkdtempSync(path.join(tmpdir(), "gv-codex-app-server-"))
  const env = withThreadMap(temp)
  try {
    const client = fakeClient(["ignored"])
    const threadID = await resolveAppServerThreadId(client, caller("gv-session", ""), {
      threadMode: "resume",
      threadId: "codex-existing",
      cwd: "/workspace/OSG-Project",
    })

    assert.equal(threadID, "codex-existing")
    assert.deepEqual(client.requests, [{
      method: "thread/resume",
      params: {
        threadId: "codex-existing",
        cwd: "/workspace/OSG-Project",
      },
    }])
  } finally {
    restoreEnv(env)
    rmSync(temp, { recursive: true, force: true })
  }
})

test("app-server fork mode stores the forked Codex thread binding", async () => {
  const temp = mkdtempSync(path.join(tmpdir(), "gv-codex-app-server-"))
  const env = withThreadMap(temp)
  try {
    const client = fakeClient(["codex-forked"])
    const threadID = await resolveAppServerThreadId(client, caller("gv-session", ""), {
      threadMode: "fork",
      sourceThreadId: "codex-source",
      model: "gpt-test",
      ephemeral: true,
    })

    assert.equal(threadID, "codex-forked")
    assert.deepEqual(client.requests, [{
      method: "thread/fork",
      params: {
        threadId: "codex-source",
        model: "gpt-test",
        ephemeral: true,
      },
    }])
    assert.deepEqual(readThreadMap(env.threadMapFile), {
      "gv-session": "codex-forked",
    })
  } finally {
    restoreEnv(env)
    rmSync(temp, { recursive: true, force: true })
  }
})

function caller(sessionID, threadID) {
  return { sessionID, threadID, cwd: "" }
}

function fakeClient(startedThreadIds) {
  const requests = []
  return {
    requests,
    async request(method, params) {
      requests.push({ method, params })
      if (method === "thread/resume") return { thread: { id: params.threadId } }
      if (method === "thread/fork") return { thread: { id: startedThreadIds.shift() } }
      if (method === "thread/start") return { thread: { id: startedThreadIds.shift() } }
      throw new Error(`unexpected method: ${method}`)
    },
  }
}

function withThreadMap(temp) {
  const previous = {
    GV_CODEX_THREAD_MAP_FILE: process.env.GV_CODEX_THREAD_MAP_FILE,
    GV_CODEX_APP_THREAD_MODE: process.env.GV_CODEX_APP_THREAD_MODE,
  }
  const threadMapFile = path.join(temp, "threads.json")
  process.env.GV_CODEX_THREAD_MAP_FILE = threadMapFile
  delete process.env.GV_CODEX_APP_THREAD_MODE
  return { previous, threadMapFile }
}

function restoreEnv(env) {
  restoreEnvValue("GV_CODEX_THREAD_MAP_FILE", env.previous.GV_CODEX_THREAD_MAP_FILE)
  restoreEnvValue("GV_CODEX_APP_THREAD_MODE", env.previous.GV_CODEX_APP_THREAD_MODE)
}

function restoreEnvValue(name, value) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

function readThreadMap(file) {
  return JSON.parse(readFileSync(file, "utf8"))
}
