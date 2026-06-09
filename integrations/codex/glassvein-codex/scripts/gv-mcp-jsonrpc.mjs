export function textResult(value) {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value),
      },
    ],
  }
}

export async function callHttpJsonRpcTool(server, toolName, args) {
  const result = await httpJsonRpcRequest(server, "tools/call", { name: toolName, arguments: args }, args)
  return unwrapMcpTextResult(result)
}

export async function listHttpJsonRpcTools(server) {
  const result = await httpJsonRpcRequest(server, "tools/list", {})
  return Object.fromEntries((result?.tools || []).filter(validTool).map((tool) => [
    tool.name,
    {
      target: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    },
  ]))
}

async function httpJsonRpcRequest(server, method, params, args = {}) {
  const url = new URL(server.url)
  for (const [key, value] of Object.entries(server.query || {})) {
    if (!url.searchParams.has(key)) url.searchParams.set(key, value)
  }
  if (server.runtimeQueryParam && args.ExecutorRuntimeID && !url.searchParams.has(server.runtimeQueryParam)) {
    url.searchParams.set(server.runtimeQueryParam, args.ExecutorRuntimeID)
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `${Date.now()}`,
      method,
      params,
    }),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`${server.name || "http-jsonrpc"} returned HTTP ${response.status}`)
  if (payload?.error) throw new Error(payload.error.message || JSON.stringify(payload.error))
  return payload?.result ?? payload
}

export function unwrapMcpTextResult(result) {
  const textContent = result?.content?.find?.((item) => item?.type === "text")?.text
  if (!textContent) return result
  try {
    return JSON.parse(textContent)
  } catch {
    return textContent
  }
}

export function ok(id, result) {
  return { jsonrpc: "2.0", id, result }
}

export function errorResponse(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } }
}

function validTool(tool) {
  return tool && typeof tool.name === "string" && tool.name.trim()
}
