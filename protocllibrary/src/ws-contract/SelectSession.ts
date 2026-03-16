export type SelectSessionRequest = {
  sessionID: string;
  directory?: string;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function createSelectSessionRequest(input: {
  sessionID?: string;
  directory?: string;
}): SelectSessionRequest {
  return {
    sessionID: normalizeString(input.sessionID),
    directory: normalizeString(input.directory) || undefined,
  };
}
