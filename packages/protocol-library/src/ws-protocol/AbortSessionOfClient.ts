export type AbortSessionOfClientRequest = {
  sessionID: string;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function createAbortSessionRequest(input: {
  sessionID?: string;
}): AbortSessionOfClientRequest {
  return {
    sessionID: normalizeString(input.sessionID),
  };
}
