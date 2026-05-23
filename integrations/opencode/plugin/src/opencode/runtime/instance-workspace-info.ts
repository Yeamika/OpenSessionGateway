/**
 * Instance workspace info utilities.
 *
 * This module provides functions to resolve instance workspace information
 * from directory paths and current client info.
 */

import path from "node:path"

export type InstanceWorkspaceInfo = {
  instanceWorkspaceDirectory: string
  title: string
}

/**
 * Create InstanceWorkspaceInfo from a directory path.
 *
 * @param input - Directory path
 * @returns InstanceWorkspaceInfo or null if input is empty
 */
export function instanceWorkspaceFromDirectory(input?: string): InstanceWorkspaceInfo | null {
  const instanceWorkspaceDirectory = typeof input === "string" ? input.trim() : ""
  if (!instanceWorkspaceDirectory) return null
  return {
    instanceWorkspaceDirectory,
    title: path.basename(instanceWorkspaceDirectory) || instanceWorkspaceDirectory,
  }
}

/**
 * Resolve InstanceWorkspaceInfo from current client info.
 *
 * @param current - Current client info containing cwd
 * @returns InstanceWorkspaceInfo or null
 */
export function resolveInstanceWorkspaceInfo(
  current: { cwd?: string },
): InstanceWorkspaceInfo | null {
  const instanceWorkspaceDirectory = typeof current.cwd === "string" && current.cwd.trim() ? current.cwd.trim() : ""
  return instanceWorkspaceFromDirectory(instanceWorkspaceDirectory)
}
