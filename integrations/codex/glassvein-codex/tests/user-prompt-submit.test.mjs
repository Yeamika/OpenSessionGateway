import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

import { configureCodexMcp } from "../scripts/gv-codex-configure-mcp.mjs"

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

test("UserPromptSubmit captures state, records binding, and injects bounded context when enabled", async () => {
  const pluginData = mkdtempSync(path.join(tmpdir(), "gv-codex-plugin-"))
  try {
    const stateDb = path.join(pluginData, "state_5.sqlite")
    const input = {
      hook_event_name: "UserPromptSubmit",
      session_id: "session/one",
      thread_id: "thread/one",
      turn_id: "turn-1",
      cwd: pluginRoot,
      model: "gpt-test",
      permission_mode: "default",
      prompt: "please inspect gv secret-value",
      transcript_path: null,
    }

    const result = runHook("hooks/user-prompt-submit.mjs", input, {
      PLUGIN_DATA: pluginData,
      GV_CODEX_STATE_DB: stateDb,
      GV_CODEX_SEND_ROUTER: "0",
      GV_CODEX_INJECT: "1",
      GV_CODEX_CONTEXT_INLINE: "repo hint",
      CODEX_THREAD_ID: "wrong-env-thread",
    })

    assert.equal(result.status, 0, result.stderr)
    const output = JSON.parse(result.stdout)
    assert.equal(output.continue, true)
    assert.equal(output.hookSpecificOutput.hookEventName, "UserPromptSubmit")
    assert.match(output.hookSpecificOutput.additionalContext, /GlassVein Codex context/)
    assert.match(output.hookSpecificOutput.additionalContext, /repo hint/)
    assert.match(output.hookSpecificOutput.additionalContext, /session_binding: written/)
    assert.doesNotMatch(output.hookSpecificOutput.additionalContext, /secret-value/)

    const stateFile = path.join(pluginData, "state", "session_one.jsonl")
    const lines = readFileSync(stateFile, "utf8").trim().split("\n")
    const state = JSON.parse(lines[0])
    assert.equal(state.event, "prompt_submitted")
    assert.equal(state.sessionID, "session/one")
    assert.equal(state.promptLength, 30)
    assert.match(state.promptSha256, /^[a-f0-9]{64}$/)
    assert.equal(state.promptPreview, "please inspect gv secret-value")

    const binding = await readBinding(stateDb, "thread/one")
    assert.equal(binding.session_id, "session/one")
    assert.equal(binding.thread_id, "thread/one")
  } finally {
    rmSync(pluginData, { recursive: true, force: true })
  }
})

test("UserPromptSubmit does not inject visible prompt context by default", () => {
  const pluginData = mkdtempSync(path.join(tmpdir(), "gv-codex-plugin-"))
  try {
    const input = {
      hook_event_name: "UserPromptSubmit",
      session_id: "session/two",
      thread_id: "thread/two",
      turn_id: "turn-default",
      cwd: pluginRoot,
      model: "gpt-test",
      permission_mode: "default",
      prompt: "hello",
      transcript_path: null,
    }

    const result = runHook("hooks/user-prompt-submit.mjs", input, {
      PLUGIN_DATA: pluginData,
      GV_CODEX_STATE_DB: path.join(pluginData, "state_5.sqlite"),
      GV_CODEX_SEND_ROUTER: "0",
    })

    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), {
      continue: true,
      suppressOutput: true,
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
      },
    })
  } finally {
    rmSync(pluginData, { recursive: true, force: true })
  }
})

test("Stop records completed session state without using Codex thread env", async () => {
  const pluginData = mkdtempSync(path.join(tmpdir(), "gv-codex-plugin-"))
  try {
    const stateDb = path.join(pluginData, "state_5.sqlite")
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
      GV_CODEX_STATE_DB: stateDb,
      GV_CODEX_SEND_ROUTER: "0",
      CODEX_THREAD_ID: "thread-one",
    })

    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), { continue: true, suppressOutput: true })

    const stateFile = path.join(pluginData, "state", "session_one.jsonl")
    const state = JSON.parse(readFileSync(stateFile, "utf8").trim())
    assert.equal(state.event, "assistant_stopped")
    assert.equal(state.assistantPreview, "done")

    const binding = await readBinding(stateDb, "session/one")
    assert.equal(binding.session_id, "session/one")
    assert.equal(binding.thread_id, "session/one")
  } finally {
    rmSync(pluginData, { recursive: true, force: true })
  }
})

test("PreToolUse injects direct GV Codex context into MCP arguments", () => {
  const pluginData = mkdtempSync(path.join(tmpdir(), "gv-codex-plugin-"))
  try {
    const input = {
      hook_event_name: "PreToolUse",
      session_id: "root-session",
      turn_id: "turn-3",
      agent_id: "agent-thread-1",
      agent_type: "worker",
      cwd: pluginRoot,
      model: "gpt-test",
      permission_mode: "default",
      tool_name: "mcp__refs__rg",
      tool_use_id: "tool-use-1",
      tool_input: { pattern: "GlassVein" },
      transcript_path: null,
    }

    const result = runHook("hooks/pre-tool-use.mjs", input, {
      PLUGIN_DATA: pluginData,
      GV_CODEX_ATTACH_MCP_SERVERS: "refs",
      CODEX_THREAD_ID: "wrong-env-thread",
    })

    assert.equal(result.status, 0, result.stderr)
    const output = JSON.parse(result.stdout)
    assert.equal(output.continue, true)
    assert.equal(output.suppressOutput, undefined)
    assert.equal(output.hookSpecificOutput.hookEventName, "PreToolUse")
    assert.equal(output.hookSpecificOutput.permissionDecision, "allow")
    assert.deepEqual(output.hookSpecificOutput.updatedInput, {
      pattern: "GlassVein",
      __gvCodexContext: {
        version: 1,
        sessionID: "agent-thread-1",
        threadID: "agent-thread-1",
        rootSessionID: "root-session",
        turnID: "turn-3",
        toolUseID: "tool-use-1",
        cwd: pluginRoot,
        model: "gpt-test",
        permissionMode: "default",
        agentID: "agent-thread-1",
        agentType: "worker",
      },
    })
  } finally {
    rmSync(pluginData, { recursive: true, force: true })
  }
})

test("PreToolUse leaves non-GV MCP arguments unchanged", () => {
  const pluginData = mkdtempSync(path.join(tmpdir(), "gv-codex-plugin-"))
  try {
    const input = {
      hook_event_name: "PreToolUse",
      session_id: "root-session",
      turn_id: "turn-4",
      cwd: pluginRoot,
      model: "gpt-test",
      permission_mode: "default",
      tool_name: "mcp__other__search",
      tool_use_id: "tool-use-2",
      tool_input: { query: "GlassVein" },
      transcript_path: null,
    }

    const result = runHook("hooks/pre-tool-use.mjs", input, {
      PLUGIN_DATA: pluginData,
      GV_CODEX_ATTACH_MCP_SERVERS: "refs",
    })

    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), {
      continue: true,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
      },
    })
  } finally {
    rmSync(pluginData, { recursive: true, force: true })
  }
})

test("PreToolUse recognizes slash-style GV MCP tool names", () => {
  const pluginData = mkdtempSync(path.join(tmpdir(), "gv-codex-plugin-"))
  try {
    const input = {
      hook_event_name: "PreToolUse",
      session_id: "thread-session",
      turn_id: "turn-5",
      cwd: pluginRoot,
      model: "gpt-test",
      permission_mode: "default",
      tool_name: "refs/rg",
      tool_use_id: "tool-use-3",
      tool_input: { pattern: "GlassVein" },
      transcript_path: null,
    }

    const result = runHook("hooks/pre-tool-use.mjs", input, {
      PLUGIN_DATA: pluginData,
      GV_CODEX_ATTACH_MCP_SERVERS: "refs",
    })

    assert.equal(result.status, 0, result.stderr)
    const output = JSON.parse(result.stdout)
    assert.equal(output.suppressOutput, undefined)
    assert.equal(output.hookSpecificOutput.updatedInput.__gvCodexContext.threadID, "thread-session")
    assert.equal(output.hookSpecificOutput.updatedInput.__gvCodexContext.toolUseID, "tool-use-3")
  } finally {
    rmSync(pluginData, { recursive: true, force: true })
  }
})

test("PreToolUse discovers configured GV MCP servers from Codex config", async () => {
  const temp = mkdtempSync(path.join(tmpdir(), "gv-codex-config-"))
  try {
    const registryFile = path.join(temp, "gv-mcp.registry.json")
    const codexHome = path.join(temp, "codex-home")
    const configFile = path.join(codexHome, "config.toml")
    writeFileSync(registryFile, JSON.stringify({
      servers: {
        refs: {
          type: "http-jsonrpc",
          url: "http://127.0.0.1:9999/mcp/refs",
          inject: ["ExecutorSessionID"],
          tools: {
            rg: {
              inputSchema: { type: "object", properties: {}, additionalProperties: true },
            },
          },
        },
      },
    }), "utf8")

    await configureCodexMcp({ registryFile, configFile, servers: ["refs"] })

    const input = {
      hook_event_name: "PreToolUse",
      session_id: "thread-session",
      turn_id: "turn-6",
      cwd: pluginRoot,
      model: "gpt-test",
      permission_mode: "default",
      tool_name: "mcp__refs__rg",
      tool_use_id: "tool-use-4",
      tool_input: { pattern: "GlassVein" },
      transcript_path: null,
    }

    const result = runHook("hooks/pre-tool-use.mjs", input, {
      PLUGIN_DATA: temp,
      CODEX_HOME: codexHome,
    })

    assert.equal(result.status, 0, result.stderr)
    const output = JSON.parse(result.stdout)
    assert.equal(output.suppressOutput, undefined)
    assert.equal(output.hookSpecificOutput.updatedInput.__gvCodexContext.threadID, "thread-session")
    assert.equal(output.hookSpecificOutput.updatedInput.__gvCodexContext.toolUseID, "tool-use-4")
  } finally {
    rmSync(temp, { recursive: true, force: true })
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

async function readBinding(dbPath, threadID) {
  const { DatabaseSync } = await import("node:sqlite")
  const db = new DatabaseSync(dbPath)
  try {
    return db.prepare("SELECT thread_id, session_id FROM gv_session_bindings WHERE thread_id = ?").get(threadID)
  } finally {
    db.close()
  }
}
