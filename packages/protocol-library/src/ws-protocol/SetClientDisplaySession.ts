export type SetClientDisplaySessionRequest = {
  displayID: string;
  sessionID: string;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function createSetClientDisplaySessionRequest(input: {
  displayID?: string;
  sessionID?: string;
}): SetClientDisplaySessionRequest {
  return {
    displayID: normalizeString(input.displayID),
    sessionID: normalizeString(input.sessionID),
  };
}
