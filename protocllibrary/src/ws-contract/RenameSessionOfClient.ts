export type RenameSessionOfClientRequest = {
  sessionID: string;
  title: string;
  directory?: string;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function createRenameSessionRequest(input: {
  sessionID?: string;
  title?: string;
  directory?: string;
}): RenameSessionOfClientRequest {
  return {
    sessionID: normalizeString(input.sessionID),
    title: normalizeString(input.title),
    directory: normalizeString(input.directory) || undefined,
  };
}
