/**
 * ListInstanceWorkspaceAvailableAgents — list available agents handler.
 *
 * Uses v2 SDK: client.app.agents({ directory })
 */

import { type OpencodeClient } from "@opencode-ai/sdk/v2"

export type AgentItem = {
  name: string
  description?: string
  mode: string
  hidden?: boolean
}

export type ListInstanceWorkspaceAvailableAgentsResponse = {
  realsize: number
  list: AgentItem[]
  error?: string
}

export type ListInstanceWorkspaceAvailableAgentsRequest = {
  instanceWorkspaceDirectory: string
  list: number
  regex?: string
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export function createListInstanceWorkspaceAvailableAgentsRequest(payload: Record<string, unknown>): ListInstanceWorkspaceAvailableAgentsRequest {
  const instanceWorkspaceDirectory = typeof payload.instanceWorkspaceDirectory === "string" ? payload.instanceWorkspaceDirectory.trim() : ""
  const listRaw = Number(payload.list)
  const list = Number.isInteger(listRaw) && listRaw > 0 ? Math.min(listRaw, 100) : 20
  const regex = typeof payload.regex === "string" ? payload.regex.trim() : undefined
  return { instanceWorkspaceDirectory, list, regex }
}

export async function handleListInstanceWorkspaceAvailableAgents(
  client: OpencodeClient,
  payload: Record<string, unknown>,
): Promise<ListInstanceWorkspaceAvailableAgentsResponse> {
  const req = createListInstanceWorkspaceAvailableAgentsRequest(payload || {})
  if (!req.instanceWorkspaceDirectory) {
    return { realsize: 0, list: [], error: "instanceWorkspaceDirectory is required" }
  }

  let rows: unknown[] = []
  try {
    const res = await client.app.agents({
      directory: req.instanceWorkspaceDirectory,
    })
    const raw = res && typeof res === "object" && "data" in res
      ? (res as { data?: unknown }).data
      : res
    rows = Array.isArray(raw) ? raw : []
  } catch {
    rows = []
  }

  const rx = req.regex
    ? (() => {
        try {
          return new RegExp(req.regex, "i")
        } catch {
          return null
        }
      })()
    : null

  const list = rows
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => ({
      name: text(item.name),
      description: text(item.description) || undefined,
      mode: text(item.mode),
      hidden: item.hidden === true ? true : undefined,
    }))
    .filter((item) => item.name && item.mode)
    .filter((item) => !rx || rx.test(item.name) || rx.test(item.description || "") || rx.test(item.mode))
    .sort((a, b) => a.name.localeCompare(b.name))

  return { realsize: list.length, list: list.slice(0, req.list) }
}
