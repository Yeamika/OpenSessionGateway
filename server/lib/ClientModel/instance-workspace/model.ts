export type RuntimeInstanceWorkspaceBundle = {
  runtimeID: string;
  instanceWorkspaceDirectory: string;
  title: string | null;
};

export function createRuntimeInstanceWorkspaceBundle(
  runtimeID: string,
  instanceWorkspaceDirectory: string,
  title?: string | null,
): RuntimeInstanceWorkspaceBundle {
  return {
    runtimeID,
    instanceWorkspaceDirectory: instanceWorkspaceDirectory.trim(),
    title: typeof title === "string" && title.trim() ? title.trim() : null,
  };
}

export function hydrateRuntimeInstanceWorkspaceBundle(bundle: RuntimeInstanceWorkspaceBundle): RuntimeInstanceWorkspaceBundle {
  bundle.instanceWorkspaceDirectory = bundle.instanceWorkspaceDirectory.trim();
  bundle.title = typeof bundle.title === "string" && bundle.title.trim() ? bundle.title.trim() : null;
  return bundle;
}
