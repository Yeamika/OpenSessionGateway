import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

test("UserPromptSubmit captures state and injects bounded context", () => {
  const pluginData = mkdtempSync(path.join(tmpdir(), "gv-codex-plugin-"))
  try {
    const input = {
      hook_event_name: "UserPromptSubmit",
      session_id: "session/one",
      turn_id: "turn-1",
      cwd: pluginRoot,
      model: "gpt-test",
      permission_mode: "default",
      prompt: "please inspect gv secret-value",
      transcript_path: null,
    }

    const result = runHook("hooks/user-prompt-submit.mjs", input, {
      PLUGIN_DATA: pluginData,
      GV_CODEX_SEND_ROUTER: "0",
      GV_CODEX_CONTEXT_INLINE: "repo hint",
    })

    assert.equal(result.status, 0, result.stderr)
    const output = JSON.parse(result.stdout)
    assert.equal(output.continue, true)
    assert.equal(output.hookSpecificOutput.hookEventName, "UserPromptSubmit")
    assert.match(output.hookSpecificOutput.additionalContext, /GlassVein Codex context/)
    assert.match(output.hookSpecificOutput.additionalContext, /repo hint/)
    assert.doesNotMatch(output.hookSpecificOutput.additionalContext, /secret-value/)

    const stateFile = path.join(pluginData, "state", "session_one.jsonl")
    const lines = readFileSync(stateFile, "utf8").trim().split("\n")
    const state = JSON.parse(lines[0])
    assert.equal(state.event, "prompt_submitted")
    assert.equal(state.sessionID, "session/one")
    assert.equal(state.promptLength, 30)
    assert.match(state.promptSha256, /^[a-f0-9]{64}$/)
    assert.equal(state.promptPreview, "please inspect gv secret-value")
  } finally {
    rmSync(pluginData, { recursive: true, force: true })
  }
})

test("Stop records completed session state", () => {
  const pluginData = mkdtempSync(path.join(tmpdir(), "gv-codex-plugin-"))
  try {
    const input = {
      hook_event_name: "Stop",
      session_id: "session/one",
      turn_id: "turn-2",
      cwd: pluginRoot,
      model: "gpt-test",
      permission_mode: "default",
      stop_hook_active: false,
      last_assistant_message: "done",
      transcript_path: null,
    }

    const result = runHook("hooks/stop.mjs", input, {
      PLUGIN_DATA: pluginData,
      GV_CODEX_SEND_ROUTER: "0",
    })

    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), { continue: true, suppressOutput: true })

    const stateFile = path.join(pluginData, "state", "session_one.jsonl")
    const state = JSON.parse(readFileSync(stateFile, "utf8").trim())
    assert.equal(state.event, "assistant_stopped")
    assert.equal(state.assistantPreview, "done")
  } finally {
    rmSync(pluginData, { recursive: true, force: true })
  }
})

function runHook(relativeScript, input, env) {
  return spawnSync("node", [path.join(pluginRoot, relativeScript)], {
    cwd: pluginRoot,
    env: { ...process.env, ...env },
    input: JSON.stringify(input),
    encoding: "utf8",
  })
}
