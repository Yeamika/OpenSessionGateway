export async function getSessionMsg(runtimeID: string, sessionID: string): Promise<Record<string, unknown>> {
  return {
    runtimeID,
    sessionID,
    realsize: 0,
    list: [],
    status: "interrupted",
    error: "not implemented in client-template",
  };
}
