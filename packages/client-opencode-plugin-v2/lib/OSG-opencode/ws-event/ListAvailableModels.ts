import { type ListAvailableModelsResponse } from "@opensessiongateway/protocol-library/ws-protocol/ListAvailableModels.js";

export async function handleListAvailableModels(
  _ctx: any,
  _query: () => Record<string, unknown>,
  _payload: Record<string, unknown>,
): Promise<ListAvailableModelsResponse> {
  return { realsize: 0, list: [] };
}
