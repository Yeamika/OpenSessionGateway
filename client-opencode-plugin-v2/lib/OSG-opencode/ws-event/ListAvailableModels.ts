import { createListAvailableModelsRequest, type ListAvailableModelsResponse } from "protocllibrary/ws-contract/ListAvailableModels.js";

function readStringArg(src: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = src[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function readRegexArg(src: Record<string, unknown>): RegExp | null {
  const text = readStringArg(src, ["regex"]);
  if (!text) return null;
  try {
    return new RegExp(text);
  } catch {
    return null;
  }
}

function modelUsable(model: Record<string, unknown>): boolean {
  const status = typeof model.status === "string" ? model.status.trim().toLowerCase() : "";
  if (status === "deprecated") return false;

  // Gateway-client-control targets interactive session models.
  // Keep models unless SDK explicitly marks tool call as false.
  const caps = model.capabilities && typeof model.capabilities === "object"
    ? (model.capabilities as Record<string, unknown>)
    : null;
  if (caps && caps.toolcall === false) return false;
  if (model.tool_call === false) return false;

  if (caps) {
    const input = caps.input && typeof caps.input === "object" ? (caps.input as Record<string, unknown>) : {};
    const output = caps.output && typeof caps.output === "object" ? (caps.output as Record<string, unknown>) : {};
    if (typeof input.text === "boolean" && !input.text) return false;
    if (typeof output.text === "boolean" && !output.text) return false;
  } else {
    const modalities = model.modalities && typeof model.modalities === "object"
      ? (model.modalities as Record<string, unknown>)
      : null;
    if (modalities) {
      const input = Array.isArray(modalities.input) ? modalities.input : [];
      const output = Array.isArray(modalities.output) ? modalities.output : [];
      const canTextInput = input.length === 0 || input.includes("text");
      const canTextOutput = output.length === 0 || output.includes("text");
      if (!canTextInput || !canTextOutput) return false;
    }
  }

  return true;
}

function readProvidersFromAny(raw: unknown): Array<Record<string, unknown>> {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (Array.isArray(src.all)) {
    return src.all.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
  }
  if (Array.isArray(src.providers)) {
    return src.providers.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
  }
  return [];
}

export async function handleListAvailableModels(
  ctx: any,
  query: () => Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<ListAvailableModelsResponse> {
  const { list: limit } = createListAvailableModelsRequest(payload);
  const regex = readRegexArg(payload);

  const runtimeQuery = query();

  const tryProviderList = async () => {
    const calls = [
      () => ctx?.client?.provider?.list?.({ query: runtimeQuery }),
      () => ctx?.client?.provider?.list?.(runtimeQuery),
      () => ctx?.client?.provider?.list?.({}),
    ];
    for (const call of calls) {
      const result = await Promise.resolve(call()).catch(() => null);
      if (result && !result.error) return result;
    }
    return null;
  };

  const tryConfigProviders = async () => {
    const calls = [
      () => ctx?.client?.config?.providers?.({ query: runtimeQuery }),
      () => ctx?.client?.config?.providers?.(runtimeQuery),
      () => ctx?.client?.config?.providers?.({}),
    ];
    for (const call of calls) {
      const result = await Promise.resolve(call()).catch(() => null);
      if (result && !result.error) return result;
    }
    return null;
  };

  const listResult = await tryProviderList();
  const configProvidersResult = (!listResult || listResult.error) ? await tryConfigProviders() : null;

  if ((!listResult || listResult.error) && (!configProvidersResult || configProvidersResult.error)) {
    return { realsize: 0, list: [] };
  }

  const rows: Array<{ providerID: string; modelID: string; name: string; id: string }> = [];
  const providers = readProvidersFromAny(listResult && !listResult.error ? listResult.data : configProvidersResult?.data);
  for (const provider of providers) {
    if (!provider || typeof provider !== "object") continue;
    const providerObj = provider as Record<string, unknown>;
    const providerID = typeof providerObj.id === "string" ? providerObj.id.trim() : "";
    if (!providerID) continue;

    const providerModels = providerObj.models && typeof providerObj.models === "object"
      ? (providerObj.models as Record<string, unknown>)
      : {};
    for (const modelKey of Object.keys(providerModels)) {
      const item = providerModels[modelKey];
      if (!item || typeof item !== "object") continue;
      const model = item as Record<string, unknown>;
      if (!modelUsable(model)) continue;
      const modelID = typeof model.id === "string" ? model.id.trim() : "";
      if (!modelID) continue;
      const name = typeof model.name === "string" && model.name.trim() ? model.name.trim() : modelID;
      const id = `${providerID}/${modelID}`;
      if (regex && !regex.test(id) && !regex.test(name) && !regex.test(providerID)) {
        continue;
      }
      rows.push({ providerID, modelID, name, id });
    }
  }

  return {
    realsize: rows.length,
    list: rows.slice(0, limit),
  };
}
