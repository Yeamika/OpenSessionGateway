export type JsonRpcRequest = {
  id?: unknown;
  method?: unknown;
};

export function successResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

export function errorResult(id: unknown, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data !== undefined ? { data } : {}),
    },
  };
}

export function parseRpc(payload: unknown): { id: unknown; method: string } {
  const rpc = payload && typeof payload === "object" ? (payload as JsonRpcRequest) : {};
  return {
    id: rpc.id,
    method: typeof rpc.method === "string" ? rpc.method : "",
  };
}
