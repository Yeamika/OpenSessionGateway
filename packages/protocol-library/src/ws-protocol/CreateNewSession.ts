export type CreateNewSessionRequest = {
  instanceWorkspaceDirectory: string;
  content: string;
  title?: string;
  model?: string;
};

export type CreateNewSessionResponse = {
  ok: boolean;
  sessionID: string;
  content: string;
  title?: string;
  model?: string;
  session?: {
    id: string;
    projectID?: string;
    parentID?: string;
    title: string;
    version?: string;
    time?: {
      created?: number;
      updated?: number;
      compacting?: number;
    };
  };
  error?: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function session(raw: unknown): CreateNewSessionResponse["session"] {
  if (!raw || typeof raw !== "object") return undefined;
  const src = raw as Record<string, unknown>;
  const id = text(src.id);
  const title = text(src.title);
  if (!id || !title) return undefined;
  const time = src.time && typeof src.time === "object" ? (src.time as Record<string, unknown>) : {};
  return {
    id,
    projectID: text(src.projectID) || undefined,
    parentID: text(src.parentID) || undefined,
    title,
    version: text(src.version) || undefined,
    time: {
      created: num(time.created),
      updated: num(time.updated),
      compacting: num(time.compacting),
    },
  };
}

export function createNewSessionRequest(input: {
  instanceWorkspaceDirectory?: string;
  content?: string;
  title?: string;
  model?: string;
}): CreateNewSessionRequest {
  return {
    instanceWorkspaceDirectory: text(input.instanceWorkspaceDirectory),
    content: typeof input.content === "string" ? input.content : "",
    title: text(input.title) || undefined,
    model: text(input.model) || undefined,
  };
}

export function readCreateNewSessionResponse(raw: unknown): CreateNewSessionResponse {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    ok: src.ok === true,
    sessionID: text(src.sessionID),
    content: typeof src.content === "string" ? src.content : "",
    title: text(src.title) || undefined,
    model: text(src.model) || undefined,
    session: session(src.session),
    error: text(src.error) || text(src.message) || undefined,
  };
}
