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
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`${server.name} returned HTTP ${response.status}`)
  if (payload?.error) throw new Error(payload.error.message || JSON.stringify(payload.error))
  return unwrapMcpTextResult(payload?.result ?? payload)
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
