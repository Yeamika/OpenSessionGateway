export async function abortSessionOfClient(runtimeID: string, sessionID: string): Promise<Record<string, unknown>> {
  return {
    ok: false,
    aborted: false,
    runtimeID,
    sessionID,
    error: "not implemented in client-template",
  };
}
