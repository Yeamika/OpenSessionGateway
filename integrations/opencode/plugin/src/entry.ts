/**
 * @opensessiongateway/opencode-vein-plugin — opencode plugin entry.
 *
 * This is the top-level entry that opencode loads and calls.
 * Structural parity with OSG's client-opencode-plugin-v2/index.ts.
 *
 * One GvOpencodeInstanceClient per workspace directory.
 * All instances share VeinManager's single WS connection.
 */

import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2/client"
import { applyOsgMcpConfig } from "./opencode/runtime/mcp.js"
import {
  OSG_TUI_STATUS_EVENT,
  OSG_TUI_CONFIG_SAVE_EVENT,
  OSG_TUI_CONFIG_SAVED_EVENT,
  OSG_TUI_CONFIG_FAILED_EVENT,
} from "./opencode/constants.js"
import { createQuery } from "./opencode/query.js"
import { GvOpencodeInstanceClient } from "./opencode/gv-opencode-instance-client.js"
import { VeinManager } from "./opencode/vein-manager.js"

export * from "./index.js"

const pluginName = "@opensessiongateway/opencode-vein-plugin"
const pluginSlug = "opencode-vein-plugin"

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function specText(value: unknown) {
  if (Array.isArray(value)) return text(value[0])
  return text(value)
}

function specName(value: unknown) {
  const spec = specText(value)
  if (!spec) return ""
  if (spec.includes(pluginName) || spec.endsWith(pluginSlug)) return pluginName
  if (spec.startsWith("file://") || spec.startsWith(".") || spec.startsWith("/") || /^[A-Za-z]:[\\/]/.test(spec)) return spec
  const at = spec.lastIndexOf("@")
  return at > 0 ? spec.slice(0, at) : spec
}

function isGvSpec(value: unknown) {
  const spec = specText(value)
  return specName(spec) === pluginName || spec.includes(pluginSlug)
}

function findOrigin(ctx: any, config?: Record<string, unknown>) {
  const direct = record(ctx?.plugin)
  const directScope = text(direct.scope)
  if (directScope === "global" || directScope === "local") {
    return {
      scope: directScope,
      source: text(direct.source),
      spec: text(direct.spec) || pluginName,
    }
  }

  const origins = Array.isArray(config?.plugin_origins) ? config.plugin_origins : []
  for (const item of origins) {
    const origin = record(item)
    if (!isGvSpec(origin.spec)) continue
    const scope = text(origin.scope)
    if (scope !== "global" && scope !== "local") continue
    return {
      scope,
      source: text(origin.source),
      spec: specText(origin.spec),
    }
  }
}

function globalError(ctx: any, config?: Record<string, unknown>) {
  const origin = findOrigin(ctx, config)
  if (!origin || origin.scope === "global") return ""
  return `${pluginName} must be installed globally; found local plugin from ${origin.source || origin.spec || "project config"}. Remove the project entry and run: opencode plug ${pluginName} --global`
}

export const GvVeinPlugin = async (ctx: any) => {
  const query = createQuery(ctx)
  const serverUrl = ctx?.serverUrl ? String(ctx.serverUrl) : ""
  const directory = ctx?.directory ? String(ctx.directory) : ""
  const v2client = createOpencodeClient({
    baseUrl: serverUrl,
    directory,
  })
  const client = new GvOpencodeInstanceClient(ctx, query, v2client)

  let start: Promise<void> | null = null
  let refused = ""

  async function ensure(config?: Record<string, unknown>) {
    if (refused) return false
    const error = globalError(ctx, config)
    if (error) {
      refused = error
      await client.writeLog("error", "gv plugin refused non-global install", { error })
      await VeinManager.reject(error, ctx)
      throw new Error(error)
    }
    if (!start) start = client.start()
    await start
    return true
  }

  return {
    async config(config: Record<string, unknown>) {
      if (!(await ensure(config))) return
      const result = await applyOsgMcpConfig(config, client.writeLog, () => client.getRuntimeID(), () => client.getInstanceWorkspaceDirectoryForMcp(), () => client.getRouterUrl())
      VeinManager.rememberInstanceMcpMetadata?.(ctx.directory, result.metadata)
    },
    event: async ({ event }: { event: any }) => {
      if (refused) {
        if (event?.type === "tui.display.report") await VeinManager.reject(refused, ctx)
        return
      }
      if (event?.type === OSG_TUI_CONFIG_SAVE_EVENT) {
        try {
          await ensure()
          await client.saveTuiConfig?.(event?.properties)
        } catch (error) {
          await VeinManager.reject(error instanceof Error ? error.message : String(error), ctx)
        }
        return
      }
      if (event?.type === "tui.display.report") {
        try {
          await ensure()
          await client.reportTuiStatus?.()
        } catch (error) {
          await VeinManager.reject(error instanceof Error ? error.message : String(error), ctx)
        }
        return
      }
      if (
        event?.type === OSG_TUI_STATUS_EVENT
        || event?.type === OSG_TUI_CONFIG_SAVED_EVENT
        || event?.type === OSG_TUI_CONFIG_FAILED_EVENT
      ) {
        return
      }
      await client.onEvent(event)
    },
    cleanup() {
      client.stop()
    },
  }
}

export const GvVeinPluginModule = {
  id: pluginName,
  server: GvVeinPlugin,
}

export default GvVeinPluginModule
