export async function listLastUsedModelOfSession(runtimeID: string): Promise<Record<string, unknown>> {
  return {
    runtimeID,
    sessionID: "",
    providerID: "",
    modelID: "",
    id: "",
    time: "",
    error: "not implemented in client-template",
  };
}
