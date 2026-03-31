export type RenameSessionOfClientRequest = {
  sessionID: string;
  title: string;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function createRenameSessionRequest(input: {
  sessionID?: string;
  title?: string;
}): RenameSessionOfClientRequest {
  return {
    sessionID: normalizeString(input.sessionID),
    title: normalizeString(input.title),
  };
}
