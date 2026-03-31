import path from "node:path";
import { instanceWorkspaceFromDirectory, type InstanceWorkspaceInfo } from "./instance-workspace-info.js";

export type SessionTargetContext = {
  sessionID: string;
  instanceWorkspaceDirectory: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readSessionInstanceWorkspaceDirectory(value: unknown): string {
  const src = record(value);
  return text(src.instanceWorkspaceDirectory) || text(src.directory);
}

export async function resolveTargetSessionContext(ctx: any, sessionID: string): Promise<SessionTargetContext | null> {
  const cleanSessionID = text(sessionID);
  if (!cleanSessionID) return null;

  const result = await ctx?.client?.session
    ?.get?.({
      path: { id: cleanSessionID },
    })
    .catch(() => null);

  if (!result || result.error) return null;
  const instanceWorkspaceDirectory = readSessionInstanceWorkspaceDirectory(result.data);
  if (!instanceWorkspaceDirectory) return null;

  return {
    sessionID: cleanSessionID,
    instanceWorkspaceDirectory,
  };
}

export async function resolveTargetInstanceWorkspaceContext(
  _ctx: any,
  input: { instanceWorkspaceDirectory?: string },
): Promise<InstanceWorkspaceInfo | null> {
  const requestedDirectory = text(input.instanceWorkspaceDirectory);
  if (!requestedDirectory) return null;
  return instanceWorkspaceFromDirectory(path.resolve(requestedDirectory));
}
