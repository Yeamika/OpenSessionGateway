export type RuntimeInstanceWorkspaceMcpState = {
  callerKeys: Set<string>;
};

export function createRuntimeInstanceWorkspaceMcpState(): RuntimeInstanceWorkspaceMcpState {
  return { callerKeys: new Set<string>() };
}

export function hydrateRuntimeInstanceWorkspaceMcpState(value: unknown): RuntimeInstanceWorkspaceMcpState {
  if (!value || typeof value !== "object") {
    return createRuntimeInstanceWorkspaceMcpState();
  }
  const row = value as Partial<RuntimeInstanceWorkspaceMcpState>;
  if (!(row.callerKeys instanceof Set)) {
    return createRuntimeInstanceWorkspaceMcpState();
  }
  return { callerKeys: row.callerKeys };
}
