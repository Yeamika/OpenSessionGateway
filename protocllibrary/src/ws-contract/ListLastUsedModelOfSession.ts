export type LastUsedModelOfSessionResponse = {
  runtimeID: string;
  sessionID: string;
  providerID: string;
  modelID: string;
  id: string;
  time: string;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function readLastUsedModelResponse(raw: unknown): LastUsedModelOfSessionResponse {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const runtimeID = normalizeString(src.runtimeID);
  const sessionID = normalizeString(src.sessionID);
  const providerID = normalizeString(src.providerID);
  const modelID = normalizeString(src.modelID);
  const id = normalizeString(src.id) || `${providerID}/${modelID}`;
  const time = normalizeString(src.time);

  return {
    runtimeID,
    sessionID,
    providerID,
    modelID,
    id,
    time,
  };
}
