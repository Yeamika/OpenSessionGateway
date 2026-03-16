export type ListAvailableModelsRequest = {
  list: number;
  regex?: string;
};

export type ModelItem = {
  providerID: string;
  modelID: string;
  name: string;
  id: string;
};

export type ListAvailableModelsResponse = {
  realsize: number;
  list: ModelItem[];
};

function normalizeList(value: unknown, fallback = 10): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function createListAvailableModelsRequest(input: {
  list?: number;
  regex?: string;
}): ListAvailableModelsRequest {
  return {
    list: normalizeList(input.list, 10),
    regex: normalizeString(input.regex) || undefined,
  };
}

export function readListAvailableModelsResponse(raw: unknown): ListAvailableModelsResponse {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rows = Array.isArray(src.list) ? src.list : [];
  const list: ModelItem[] = [];

  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const providerID = normalizeString(row.providerID);
    const modelID = normalizeString(row.modelID);
    const name = normalizeString(row.name);
    const id = normalizeString(row.id) || `${providerID}/${modelID}`;
    if (!providerID || !modelID) continue;
    list.push({ providerID, modelID, name: name || modelID, id });
  }

  const realsizeRaw = Number(src.realsize);
  const realsize = Number.isInteger(realsizeRaw) && realsizeRaw >= 0 ? realsizeRaw : list.length;
  return { realsize, list };
}
