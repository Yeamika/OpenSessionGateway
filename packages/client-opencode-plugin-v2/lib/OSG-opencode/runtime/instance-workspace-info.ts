import path from "node:path";
import type { CurrentClientInfo } from "../ws-event/CurrentClientInfo.js";

export type InstanceWorkspaceInfo = {
  instanceWorkspaceDirectory: string;
  title: string;
};

export function instanceWorkspaceFromDirectory(input?: string): InstanceWorkspaceInfo | null {
  const instanceWorkspaceDirectory = typeof input === "string" ? input.trim() : "";
  if (!instanceWorkspaceDirectory) return null;
  return {
    instanceWorkspaceDirectory,
    title: path.basename(instanceWorkspaceDirectory) || instanceWorkspaceDirectory,
  };
}

export function resolveInstanceWorkspaceInfo(current: Pick<CurrentClientInfo, "cwd">): InstanceWorkspaceInfo | null {
  const instanceWorkspaceDirectory = typeof current.cwd === "string" && current.cwd.trim() ? current.cwd.trim() : "";
  return instanceWorkspaceFromDirectory(instanceWorkspaceDirectory);
}
